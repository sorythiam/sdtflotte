-- Yoon Fleet — facturation : modalités de paiement, factures numérotées sans trou, avoirs,
-- référence de transaction et chèque à l'encaissement.

alter table public.organizations add column if not exists billing jsonb;
alter table public.organizations drop constraint if exists organizations_billing_object;
alter table public.organizations add constraint organizations_billing_object
  check (billing is null or (jsonb_typeof(billing) = 'object' and octet_length(billing::text) < 20000));

-- Modalités propres à un client (vide = celles de l'entreprise).
alter table public.clients
  add column if not exists deposit_percent int check (deposit_percent is null or deposit_percent between 0 and 100),
  add column if not exists due_days int check (due_days is null or due_days between 0 and 180);

-- Encaissement : chèque accepté, référence de la transaction ou du chèque.
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('especes', 'wave', 'orange_money', 'free_money', 'mtn', 'moov', 'carte', 'virement', 'cheque'));
alter table public.payments drop constraint if exists payments_kind_check;
alter table public.payments add constraint payments_kind_check
  check (kind in ('acompte', 'solde', 'caution', 'frais', 'remboursement_caution', 'remboursement'));
alter table public.payments add column if not exists reference text check (reference is null or length(reference) <= 80);

-- ---------------------------------------------------------------- factures
create table if not exists public.invoice_counters (
  org_id uuid not null references public.organizations (id) on delete cascade,
  prefix text not null check (prefix in ('FA', 'AV')),
  year int not null,
  last int not null,
  primary key (org_id, prefix, year)
);
alter table public.invoice_counters enable row level security; -- aucun accès direct : seul le déclencheur s'en sert

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  number text not null,
  reservation_id uuid not null references public.reservations (id) on delete restrict,
  client_id uuid not null references public.clients (id) on delete restrict,
  kind text not null check (kind in ('facture', 'complement', 'avoir')),
  issue_date date not null,
  due_date date not null,
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  total_ht bigint not null,
  vat_rate numeric(5, 2) not null default 0 check (vat_rate between 0 and 100),
  vat bigint not null default 0,
  total_ttc bigint not null,
  deposit_due bigint not null default 0,
  terms text,
  bill_to jsonb not null,
  related_invoice_id uuid references public.invoices (id) on delete restrict,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, number),
  check (total_ttc = total_ht + vat),
  check ((kind = 'avoir') = (total_ttc <= 0) or total_ttc = 0),
  check ((kind = 'avoir') = (related_invoice_id is not null))
);
create index if not exists invoices_org_reservation on public.invoices (org_id, reservation_id);

-- Numéro attribué par la base, sans trou : FA-2026-0001 pour les factures, AV-2026-0001 pour les avoirs.
-- Le compteur est mis à jour dans la même transaction que la facture : une facture refusée ne consomme pas de numéro.
create or replace function public.number_invoice()
returns trigger language plpgsql security definer set search_path = public as $$
declare p text; y int; n int;
begin
  p := case when new.kind = 'avoir' then 'AV' else 'FA' end;
  y := extract(year from new.issue_date)::int;
  insert into invoice_counters as c (org_id, prefix, year, last) values (new.org_id, p, y, 1)
  on conflict (org_id, prefix, year) do update set last = c.last + 1
  returning last into n;
  new.number := p || '-' || y || '-' || lpad(n::text, 4, '0');
  new.created_by := auth.uid();
  new.created_at := now();
  -- La réservation, le client et la facture d'origine doivent appartenir à la même entreprise.
  if not exists (select 1 from reservations where id = new.reservation_id and org_id = new.org_id)
     or not exists (select 1 from clients where id = new.client_id and org_id = new.org_id)
     or (new.related_invoice_id is not null and not exists (
           select 1 from invoices where id = new.related_invoice_id and org_id = new.org_id and kind <> 'avoir')) then
    raise exception 'Facture incohérente' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists invoices_number on public.invoices;
create trigger invoices_number before insert on public.invoices
  for each row execute function number_invoice();
revoke execute on function public.number_invoice() from public, anon, authenticated;

-- Une facture émise ne se modifie ni ne se supprime : on établit un avoir.
alter table public.invoices enable row level security;
drop policy if exists invoices_read on public.invoices;
create policy invoices_read on public.invoices for select using (is_member(org_id));
drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert on public.invoices for insert
  with check (has_role(org_id, array['admin', 'direction', 'agent', 'comptable']));
-- (aucune règle update / delete : refusés pour tous les utilisateurs)
