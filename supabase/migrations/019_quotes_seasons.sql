-- Yoon Fleet — devis, saisons tarifaires et date d'entrée des véhicules dans la flotte.

-- Entrée dans la flotte : sert au calcul de rentabilité. Les véhicules existants restent sans date
-- (comptés sur toute la période) ; les nouveaux prennent la date de création.
alter table public.vehicles add column if not exists created_at timestamptz;
alter table public.vehicles alter column created_at set default now();

create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  label text not null check (length(label) between 2 and 80),
  start_date date not null,
  end_date date not null,
  recurring boolean not null default true,
  percent int not null check (percent between -50 and 200 and percent <> 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (recurring or end_date >= start_date)
);
create index if not exists seasons_org on public.seasons (org_id);
alter table public.seasons enable row level security;
drop policy if exists seasons_read on public.seasons;
create policy seasons_read on public.seasons for select using (is_member(org_id));
drop policy if exists seasons_insert on public.seasons;
create policy seasons_insert on public.seasons for insert with check (has_role(org_id, array['admin', 'direction']));
drop policy if exists seasons_update on public.seasons;
create policy seasons_update on public.seasons for update
  using (has_role(org_id, array['admin', 'direction'])) with check (has_role(org_id, array['admin', 'direction']));
drop policy if exists seasons_delete on public.seasons;
create policy seasons_delete on public.seasons for delete using (has_role(org_id, array['admin', 'direction']));

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  number text not null check (length(number) between 3 and 30),
  client_id uuid not null references public.clients (id) on delete restrict,
  category text not null check (length(category) between 1 and 60),
  quantity int not null default 1 check (quantity between 1 and 50),
  formula text not null default 'jour' check (formula in ('jour', 'demi_journee', 'forfait')),
  package_id uuid references public.packages (id) on delete set null,
  package_label text check (package_label is null or length(package_label) <= 120),
  start timestamptz not null,
  "end" timestamptz not null,
  with_driver boolean not null default false,
  passengers int check (passengers is null or passengers between 1 and 999),
  mission_fees int not null default 0 check (mission_fees >= 0),
  fuel_included boolean not null default false,
  itinerary text check (itinerary is null or length(itinerary) <= 500),
  cross_border text check (cross_border is null or length(cross_border) <= 120),
  unit_total int not null check (unit_total >= 0),
  total int not null check (total >= 0),
  caution int not null default 0 check (caution >= 0),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  valid_until date not null,
  status text not null default 'envoye' check (status in ('envoye', 'accepte', 'refuse', 'converti')),
  reservation_ids uuid[] not null default '{}',
  notes text check (notes is null or length(notes) <= 500),
  created_by text check (created_by is null or length(created_by) <= 160),
  created_at timestamptz not null default now(),
  unique (org_id, number),
  check ("end" > start)
);
create index if not exists quotes_org on public.quotes (org_id);

create or replace function public.check_quote_links()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from clients where id = new.client_id and org_id = new.org_id) then
    raise exception 'Client inconnu' using errcode = 'P0001';
  end if;
  if new.package_id is not null and not exists (select 1 from packages where id = new.package_id and org_id = new.org_id) then
    raise exception 'Forfait inconnu' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.check_quote_links() from public, anon, authenticated;
drop trigger if exists quotes_links on public.quotes;
create trigger quotes_links before insert or update on public.quotes for each row execute function check_quote_links();

alter table public.quotes enable row level security;
drop policy if exists quotes_read on public.quotes;
create policy quotes_read on public.quotes for select using (has_role(org_id, array['admin', 'direction', 'agent', 'comptable']));
drop policy if exists quotes_insert on public.quotes;
create policy quotes_insert on public.quotes for insert with check (has_role(org_id, array['admin', 'direction', 'agent']));
drop policy if exists quotes_update on public.quotes;
create policy quotes_update on public.quotes for update
  using (has_role(org_id, array['admin', 'direction', 'agent'])) with check (has_role(org_id, array['admin', 'direction', 'agent']));
drop policy if exists quotes_delete on public.quotes;
create policy quotes_delete on public.quotes for delete using (has_role(org_id, array['admin', 'direction']));

do $$
declare t text;
begin
  foreach t in array array['seasons', 'quotes'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function write_audit()', t || '_audit', t);
  end loop;
end $$;
