-- Yoon Fleet — module Chauffeurs VTC : véhicule confié à un chauffeur contre un versement journalier,
-- en location simple ou en location-vente. Yoon Fleet enregistre les versements, il ne les encaisse pas.

create table if not exists public.vtc_contracts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  number text not null check (length(number) between 3 and 30),
  vehicle_id uuid not null references public.vehicles (id) on delete restrict,
  driver_id uuid not null references public.drivers (id) on delete restrict,
  formula text not null check (formula in ('versement', 'location_vente')),
  platform text check (platform is null or length(platform) <= 40),
  daily_amount int not null check (daily_amount between 1000 and 1000000),
  rest_days int[] not null default '{0}' check (rest_days <@ array[0, 1, 2, 3, 4, 5, 6]),
  start_date date not null,
  end_date date,
  caution int not null default 0 check (caution >= 0),
  total_price int check (total_price is null or total_price > 0),
  charges jsonb not null default '{}'::jsonb check (jsonb_typeof(charges) = 'object'),
  status text not null default 'actif' check (status in ('actif', 'suspendu', 'termine', 'transfere')),
  notes text check (notes is null or length(notes) <= 1000),
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  check (formula <> 'location_vente' or total_price is not null)
);
create index if not exists vtc_contracts_org on public.vtc_contracts (org_id);

create table if not exists public.vtc_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  contract_id uuid not null references public.vtc_contracts (id) on delete cascade,
  paid_on date not null,
  amount int not null check (amount > 0 and amount <= 100000000),
  method text not null check (method in ('especes', 'wave', 'orange_money', 'free_money', 'mtn', 'moov', 'carte', 'virement', 'cheque')),
  reference text check (reference is null or length(reference) <= 80),
  note text check (note is null or length(note) <= 300),
  created_by text check (created_by is null or length(created_by) <= 160),
  created_at timestamptz not null default now()
);
create index if not exists vtc_payments_contract on public.vtc_payments (contract_id);

-- Dépenses : à la charge du propriétaire ou du chauffeur VTC.
alter table public.expenses
  add column if not exists charged_to text not null default 'proprietaire' check (charged_to in ('proprietaire', 'chauffeur')),
  add column if not exists vtc_contract_id uuid references public.vtc_contracts (id) on delete set null;

create or replace function public.check_vtc_links()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'vtc_contracts' then
    if not exists (select 1 from vehicles where id = new.vehicle_id and org_id = new.org_id)
       or not exists (select 1 from drivers where id = new.driver_id and org_id = new.org_id) then
      raise exception 'Véhicule ou chauffeur inconnu' using errcode = 'P0001';
    end if;
    if new.status = 'actif' and exists (
      select 1 from vtc_contracts c where c.vehicle_id = new.vehicle_id and c.status = 'actif' and c.id <> new.id) then
      raise exception 'Ce véhicule a déjà un contrat VTC actif.' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'vtc_payments' then
    if not exists (select 1 from vtc_contracts where id = new.contract_id and org_id = new.org_id) then
      raise exception 'Contrat VTC inconnu' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'expenses' then
    if new.vtc_contract_id is not null and not exists (select 1 from vtc_contracts where id = new.vtc_contract_id and org_id = new.org_id) then
      raise exception 'Contrat VTC inconnu' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.check_vtc_links() from public, anon, authenticated;
drop trigger if exists vtc_contracts_links on public.vtc_contracts;
create trigger vtc_contracts_links before insert or update on public.vtc_contracts for each row execute function check_vtc_links();
drop trigger if exists vtc_payments_links on public.vtc_payments;
create trigger vtc_payments_links before insert or update on public.vtc_payments for each row execute function check_vtc_links();
drop trigger if exists expenses_vtc_links on public.expenses;
create trigger expenses_vtc_links before insert or update of vtc_contract_id on public.expenses for each row execute function check_vtc_links();

alter table public.vtc_contracts enable row level security;
drop policy if exists vtc_contracts_read on public.vtc_contracts;
create policy vtc_contracts_read on public.vtc_contracts for select using (has_role(org_id, array['admin', 'direction', 'agent', 'comptable']));
drop policy if exists vtc_contracts_insert on public.vtc_contracts;
create policy vtc_contracts_insert on public.vtc_contracts for insert with check (has_role(org_id, array['admin', 'direction', 'agent']));
drop policy if exists vtc_contracts_update on public.vtc_contracts;
create policy vtc_contracts_update on public.vtc_contracts for update
  using (has_role(org_id, array['admin', 'direction', 'agent'])) with check (has_role(org_id, array['admin', 'direction', 'agent']));

alter table public.vtc_payments enable row level security;
drop policy if exists vtc_payments_read on public.vtc_payments;
create policy vtc_payments_read on public.vtc_payments for select using (has_role(org_id, array['admin', 'direction', 'agent', 'comptable']));
drop policy if exists vtc_payments_insert on public.vtc_payments;
create policy vtc_payments_insert on public.vtc_payments for insert with check (has_role(org_id, array['admin', 'direction', 'agent', 'comptable']));
-- Un versement saisi par erreur ne se modifie pas : la direction le supprime (tracé au journal) et le ressaisit.
drop policy if exists vtc_payments_delete on public.vtc_payments;
create policy vtc_payments_delete on public.vtc_payments for delete using (has_role(org_id, array['admin', 'direction']));

do $$
declare t text;
begin
  foreach t in array array['vtc_contracts', 'vtc_payments'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function write_audit()', t || '_audit', t);
  end loop;
end $$;

-- Page publique : un véhicule confié en VTC n'est pas proposé à la location.
create or replace function public.public_availability(p_slug text, p_start timestamptz, p_end timestamptz, p_passengers int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o uuid; out jsonb;
begin
  select id into o from organizations where booking_slug = lower(p_slug) and booking_enabled;
  if o is null or p_end <= p_start or p_end - p_start > interval '366 days' then
    return '{}'::jsonb;
  end if;
  select coalesce(jsonb_object_agg(category, n), '{}'::jsonb) into out from (
    select v.category, count(*) filter (where not exists (
        select 1 from reservations r
        where r.vehicle_id = v.id and r.status in ('reservee', 'en_cours')
          and r.start < p_end and p_start < r."end")
      and not exists (
        select 1 from maintenances m
        where m.vehicle_id = v.id and m.start < p_end and p_start < m."end")
      and not exists (
        select 1 from vtc_contracts c
        where c.vehicle_id = v.id and c.status in ('actif', 'suspendu')
          and c.start_date <= p_end::date and (c.end_date is null or c.end_date >= p_start::date))
      and (p_passengers is null or v.seats is null or v.seats >= p_passengers)
    ) as n
    from vehicles v
    where v.org_id = o and not v.out_of_service
    group by v.category
  ) t;
  return out;
end $$;
