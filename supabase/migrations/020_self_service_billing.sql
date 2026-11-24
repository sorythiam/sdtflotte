-- Yoon Fleet — abonnement en libre-service : le loueur paie en ligne (Wave, Orange Money, carte)
-- et sa formule s'active seule. Les paiements sont créés et validés par la fonction « billing »
-- (clé de service) ; le navigateur ne peut que les lire.

alter table public.organizations
  add column if not exists paid_until timestamptz,
  add column if not exists billing_cycle text check (billing_cycle is null or billing_cycle in ('annuel', 'mensuel'));

-- La formule, le quota et les échéances ne se modifient que par Yoon Fleet (paiement validé).
create or replace function public.protect_billing_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' and (
    new.plan is distinct from old.plan or
    new.vehicle_quota is distinct from old.vehicle_quota or
    new.trial_ends_at is distinct from old.trial_ends_at or
    new.paid_until is distinct from old.paid_until or
    new.billing_cycle is distinct from old.billing_cycle
  ) then
    raise exception 'formule et quota modifiables par Yoon Fleet uniquement';
  end if;
  return new;
end $$;

create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  plan text not null check (plan in ('essentiel', 'pro', 'entreprise')),
  vehicles int not null check (vehicles between 1 and 10000),
  billing text not null check (billing in ('annuel', 'mensuel')),
  base_ht int not null check (base_ht >= 0),
  credit_ht int not null default 0 check (credit_ht >= 0),
  amount_ht int not null check (amount_ht >= 0),
  vat_rate numeric not null default 0 check (vat_rate between 0 and 30),
  vat int not null default 0 check (vat >= 0),
  amount_ttc int not null check (amount_ttc > 0),
  provider text not null check (provider in ('paydunya', 'simulation', 'manuel')),
  provider_ref text, -- jeton du prestataire, jamais renvoyé au navigateur
  status text not null default 'en_attente' check (status in ('en_attente', 'payee', 'echouee', 'annulee')),
  period_start timestamptz,
  period_end timestamptz,
  invoice_number text unique,
  paid_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  raw jsonb
);
create index if not exists subscription_payments_org on public.subscription_payments (org_id, created_at desc);
create unique index if not exists subscription_payments_ref on public.subscription_payments (provider, provider_ref) where provider_ref is not null;

alter table public.subscription_payments enable row level security;
drop policy if exists subpay_read on public.subscription_payments;
create policy subpay_read on public.subscription_payments for select using (has_role(org_id, array['admin', 'direction']));
-- Aucune écriture depuis le navigateur.

-- Numéros de facture d'abonnement : une suite continue par année, toutes entreprises confondues.
create table if not exists public.saas_invoice_counters (year int primary key, last int not null default 0);
alter table public.saas_invoice_counters enable row level security;

/** Valide un paiement et active la formule. Appelée par la fonction « billing » seulement. */
create or replace function public.activate_subscription(p_id uuid, p_raw jsonb default null)
returns public.subscription_payments
language plpgsql security definer set search_path = public as $$
declare
  p subscription_payments;
  o organizations;
  y int := extract(year from now() at time zone 'Africa/Dakar');
  n int;
  s timestamptz := now();
  e timestamptz;
begin
  select * into p from subscription_payments where id = p_id for update;
  if not found then raise exception 'Paiement inconnu'; end if;
  if p.status = 'payee' then return p; end if; -- déjà traité : on ne double rien
  select * into o from organizations where id = p.org_id for update;
  e := case when p.billing = 'annuel' then s + interval '1 year' else s + interval '1 month' end;
  insert into saas_invoice_counters (year, last) values (y, 1)
    on conflict (year) do update set last = saas_invoice_counters.last + 1
    returning last into n;
  update subscription_payments set
    status = 'payee', paid_at = s, period_start = s, period_end = e,
    invoice_number = 'YF-' || y || '-' || lpad(n::text, 4, '0'),
    raw = coalesce(p_raw, raw)
  where id = p_id returning * into p;
  update organizations set
    plan = p.plan, vehicle_quota = p.vehicles, paid_until = e, billing_cycle = p.billing, trial_ends_at = null
  where id = p.org_id;
  return p;
end $$;
revoke execute on function public.activate_subscription(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.activate_subscription(uuid, jsonb) to service_role;
