-- Yoon Fleet — schéma Supabase multi-entreprise (V1)
-- À exécuter après supabase/reset.sql dans l'éditeur SQL de Supabase.
--
-- Principe : chaque loueur est une « organisation ». Chaque ligne métier porte
-- org_id, et les règles RLS ne laissent voir que les organisations dont
-- l'utilisateur est membre. Un loueur ne peut jamais lire les données d'un autre.

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------- organisations
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 120),
  country text not null default 'SN',
  currency text not null default 'XOF',
  plan text not null default 'pro' check (plan in ('essentiel', 'pro', 'entreprise')),
  vehicle_quota int not null default 10 check (vehicle_quota > 0),
  trial_ends_at timestamptz default (now() + interval '30 days'),
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'direction', 'agent', 'comptable', 'mecanicien')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index on public.memberships (user_id);

-- Fonctions d'appartenance : SECURITY DEFINER pour éviter la récursion RLS sur memberships.
create or replace function public.is_member(o uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where org_id = o and user_id = auth.uid());
$$;

create or replace function public.has_role(o uuid, roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships where org_id = o and user_id = auth.uid() and role = any (roles)
  );
$$;

-- Inscription : crée l'organisation et en fait l'utilisateur administrateur.
create or replace function public.create_organization(p_name text, p_country text default 'SN')
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'non authentifié'; end if;
  insert into organizations (name, country) values (p_name, coalesce(p_country, 'SN'))
    returning id into new_id;
  insert into memberships (org_id, user_id, role) values (new_id, auth.uid(), 'admin');
  insert into rates (org_id, category, daily, weekly, monthly, driver_daily, km_per_day, extra_km, caution)
  values
    (new_id, 'Citadine', 25000, 22000, 18000, 10000, 250, 100, 150000),
    (new_id, 'Berline', 35000, 31000, 25000, 12000, 250, 120, 200000),
    (new_id, 'SUV', 45000, 40000, 32000, 15000, 250, 150, 300000),
    (new_id, '4x4', 60000, 54000, 45000, 15000, 250, 200, 400000),
    (new_id, 'Minibus', 75000, 68000, 55000, 20000, 300, 200, 400000);
  return new_id;
end $$;

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;

create policy org_read on public.organizations for select using (is_member(id));
create policy org_update on public.organizations for update
  using (has_role(id, array['admin'])) with check (has_role(id, array['admin']));
create policy members_read on public.memberships for select using (is_member(org_id));
create policy members_admin on public.memberships for all
  using (has_role(org_id, array['admin'])) with check (has_role(org_id, array['admin']));

-- Empêche un administrateur de modifier lui-même la formule ou le quota (réservé à Yoon Fleet).
create or replace function public.protect_billing_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' and (
    new.plan is distinct from old.plan or
    new.vehicle_quota is distinct from old.vehicle_quota or
    new.trial_ends_at is distinct from old.trial_ends_at
  ) then
    raise exception 'formule et quota modifiables par Yoon Fleet uniquement';
  end if;
  return new;
end $$;
create trigger organizations_billing before update on public.organizations
  for each row execute function protect_billing_fields();

-- ---------------------------------------------------------------- tables métier
create table public.rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  category text not null,
  daily int not null check (daily >= 0),
  weekly int not null check (weekly >= 0),
  monthly int not null check (monthly >= 0),
  driver_daily int not null default 0,
  km_per_day int not null default 250,
  extra_km int not null default 0,
  caution int not null default 0,
  unique (org_id, category)
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  plate text not null,
  brand text not null,
  model text not null,
  year int,
  category text not null,
  fuel text not null default 'diesel' check (fuel in ('essence', 'diesel', 'hybride', 'electrique')),
  mileage int not null default 0 check (mileage >= 0),
  out_of_service boolean not null default false,
  insurance_expiry date,
  inspection_expiry date,
  vignette_expiry date,
  created_at timestamptz not null default now(),
  unique (org_id, plate)
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null default 'particulier' check (kind in ('particulier', 'entreprise')),
  name text not null,
  phone text not null,
  email text,
  id_number text,
  license_expiry date,
  score text not null default 'fiable' check (score in ('fiable', 'surveiller', 'blacklist')),
  created_at timestamptz not null default now()
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  number text not null,
  vehicle_id uuid not null references public.vehicles (id),
  client_id uuid not null references public.clients (id),
  start timestamptz not null,
  "end" timestamptz not null,
  with_driver boolean not null default false,
  status text not null default 'reservee' check (status in ('reservee', 'en_cours', 'terminee', 'annulee')),
  daily_rate int not null,
  total int not null,
  caution int not null default 0,
  fees int not null default 0 check (fees >= 0),
  mileage_out int,
  mileage_in int,
  notes text,
  created_at timestamptz not null default now(),
  check ("end" > start),
  unique (org_id, number),
  -- Garantie en base : un véhicule ne peut pas avoir deux réservations actives qui se chevauchent.
  constraint reservations_no_overlap exclude using gist (
    vehicle_id with =,
    tstzrange(start, "end", '[)') with &&
  ) where (status in ('reservee', 'en_cours'))
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  kind text not null check (kind in ('acompte', 'solde', 'caution', 'frais', 'remboursement_caution')),
  amount int not null check (amount > 0),
  method text not null check (method in ('especes', 'wave', 'orange_money', 'free_money', 'mtn', 'moov', 'carte', 'virement')),
  status text not null default 'paye' check (status in ('paye', 'en_attente', 'echoue')),
  provider_ref text unique, -- référence de l'agrégateur : un webhook reçu deux fois ne compte pas double
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.maintenances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  label text not null,
  start timestamptz not null,
  "end" timestamptz not null,
  cost int not null default 0,
  check ("end" > start)
);

create index on public.vehicles (org_id);
create index on public.clients (org_id);
create index on public.reservations (org_id, start);
create index on public.payments (org_id, reservation_id);
create index on public.maintenances (org_id, vehicle_id);

-- ---------------------------------------------------------------- quota de véhicules
create or replace function public.enforce_vehicle_quota()
returns trigger language plpgsql security definer set search_path = public as $$
declare q int; n int;
begin
  select vehicle_quota into q from organizations where id = new.org_id;
  select count(*) into n from vehicles where org_id = new.org_id and not out_of_service;
  if n >= q then
    raise exception 'Quota de % véhicules atteint pour votre formule', q using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger vehicles_quota before insert on public.vehicles
  for each row execute function enforce_vehicle_quota();

-- ---------------------------------------------------------------- RLS des tables métier
do $$
declare t text;
begin
  foreach t in array array['rates', 'vehicles', 'clients', 'reservations', 'payments', 'maintenances'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (is_member(org_id))', t || '_read', t);
  end loop;
end $$;

-- Écritures selon le profil (voir la spécification produit, « Profils et droits »).
create policy rates_write on public.rates for all
  using (has_role(org_id, array['admin', 'direction']))
  with check (has_role(org_id, array['admin', 'direction']));
create policy vehicles_write on public.vehicles for all
  using (has_role(org_id, array['admin', 'direction', 'agent', 'mecanicien']))
  with check (has_role(org_id, array['admin', 'direction', 'agent', 'mecanicien']));
create policy clients_write on public.clients for all
  using (has_role(org_id, array['admin', 'direction', 'agent']))
  with check (has_role(org_id, array['admin', 'direction', 'agent']));
create policy reservations_write on public.reservations for all
  using (has_role(org_id, array['admin', 'direction', 'agent']))
  with check (has_role(org_id, array['admin', 'direction', 'agent']));
create policy payments_write on public.payments for all
  using (has_role(org_id, array['admin', 'direction', 'agent', 'comptable']))
  with check (has_role(org_id, array['admin', 'direction', 'agent', 'comptable']));
create policy maintenances_write on public.maintenances for all
  using (has_role(org_id, array['admin', 'direction', 'mecanicien']))
  with check (has_role(org_id, array['admin', 'direction', 'mecanicien']));

-- ---------------------------------------------------------------- droits d'exécution
-- Les fonctions SECURITY DEFINER ne sont pas appelables sans connexion ;
-- celles des déclencheurs ne sont pas appelables du tout via l'API.
revoke execute on function public.create_organization(text, text) from public, anon;
revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.has_role(uuid, text[]) from public, anon;
revoke execute on function public.enforce_vehicle_quota() from public, anon, authenticated;
revoke execute on function public.protect_billing_fields() from public, anon, authenticated;
grant execute on function public.create_organization(text, text) to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.has_role(uuid, text[]) to authenticated;
