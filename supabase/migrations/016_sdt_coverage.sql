-- Yoon Fleet — fin de la couverture SDT : entretien périodique, contrats cadres entreprises, journal des actions.

-- Interventions : prestataire, pièces changées, kilométrage, plan d'entretien concerné.
alter table public.maintenances
  add column if not exists provider text check (provider is null or length(provider) <= 120),
  add column if not exists parts text check (parts is null or length(parts) <= 500),
  add column if not exists mileage int check (mileage is null or mileage >= 0),
  add column if not exists plan_id uuid;

-- Plans d'entretien : tous les X km et/ou tous les X mois, par véhicule.
create table if not exists public.maintenance_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  label text not null check (length(label) between 2 and 120),
  every_km int check (every_km is null or every_km between 500 and 200000),
  every_months int check (every_months is null or every_months between 1 and 60),
  last_km int check (last_km is null or last_km >= 0),
  last_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (every_km is not null or every_months is not null)
);
create index if not exists maintenance_plans_vehicle on public.maintenance_plans (vehicle_id);

create or replace function public.check_plan_links()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from vehicles where id = new.vehicle_id and org_id = new.org_id) then
    raise exception 'Véhicule inconnu' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists maintenance_plans_links on public.maintenance_plans;
create trigger maintenance_plans_links before insert or update on public.maintenance_plans
  for each row execute function check_plan_links();
revoke execute on function public.check_plan_links() from public, anon, authenticated;

alter table public.maintenance_plans enable row level security;
drop policy if exists maintenance_plans_read on public.maintenance_plans;
create policy maintenance_plans_read on public.maintenance_plans for select using (is_member(org_id));
drop policy if exists maintenance_plans_insert on public.maintenance_plans;
create policy maintenance_plans_insert on public.maintenance_plans for insert
  with check (has_role(org_id, array['admin', 'direction', 'mecanicien']));
drop policy if exists maintenance_plans_update on public.maintenance_plans;
create policy maintenance_plans_update on public.maintenance_plans for update
  using (has_role(org_id, array['admin', 'direction', 'mecanicien', 'agent']))
  with check (has_role(org_id, array['admin', 'direction', 'mecanicien', 'agent']));
drop policy if exists maintenance_plans_delete on public.maintenance_plans;
create policy maintenance_plans_delete on public.maintenance_plans for delete
  using (has_role(org_id, array['admin', 'direction', 'mecanicien']));

-- Contrats cadres : remise ou prix négociés par catégorie, conditions, validité.
alter table public.clients
  add column if not exists deal_discount int not null default 0 check (deal_discount between 0 and 60),
  add column if not exists deal_rates jsonb not null default '{}'::jsonb check (jsonb_typeof(deal_rates) = 'object'),
  add column if not exists deal_terms text check (deal_terms is null or length(deal_terms) <= 2000),
  add column if not exists deal_until date;

-- Journal des actions : qui a créé, modifié ou supprimé quoi, et quand. Écrit par la base, en lecture seule.
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  at timestamptz not null default now(),
  user_id uuid,
  user_email text,
  table_name text not null,
  row_id uuid,
  action text not null check (action in ('creation', 'modification', 'suppression')),
  label text,
  changes text
);
create index if not exists audit_log_org_at on public.audit_log (org_id, at desc);
alter table public.audit_log enable row level security;
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log for select using (has_role(org_id, array['admin', 'direction']));

create or replace function public.write_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  j jsonb; o jsonb; diff text; lbl text;
begin
  j := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  o := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  if tg_op = 'UPDATE' then
    select string_agg(k, ', ' order by k) into diff
    from jsonb_object_keys(j) k
    where k not in ('updated_at') and (o -> k) is distinct from (j -> k);
    if diff is null then return new; end if;
  end if;
  lbl := coalesce(j ->> 'number', j ->> 'plate', j ->> 'name', j ->> 'label', j ->> 'category', j ->> 'kind');
  insert into audit_log (org_id, user_id, user_email, table_name, row_id, action, label, changes)
  values (
    (j ->> 'org_id')::uuid, auth.uid(), auth.jwt() ->> 'email', tg_table_name, (j ->> 'id')::uuid,
    case tg_op when 'INSERT' then 'creation' when 'UPDATE' then 'modification' else 'suppression' end,
    left(lbl, 160), left(diff, 500)
  );
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke execute on function public.write_audit() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['reservations', 'payments', 'invoices', 'clients', 'vehicles', 'rates', 'maintenances',
                           'expenses', 'drivers', 'packages', 'incidents', 'maintenance_plans', 'reservation_changes', 'inspections']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function write_audit()', t || '_audit', t);
  end loop;
end $$;
