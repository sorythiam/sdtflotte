-- Yoon Fleet — dépenses par véhicule (carburant, pneus, réparations, amendes…).
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  date date not null,
  kind text not null check (kind in ('carburant', 'pneus', 'reparation', 'pieces', 'amende', 'assurance', 'taxes', 'peage', 'lavage', 'autre')),
  amount int not null check (amount > 0 and amount <= 100000000),
  label text check (label is null or length(label) <= 200),
  mileage int check (mileage is null or mileage >= 0),
  reservation_id uuid references public.reservations (id) on delete set null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists expenses_org_date on public.expenses (org_id, date);
create index if not exists expenses_vehicle on public.expenses (vehicle_id);

-- Le véhicule et le contrat doivent appartenir à la même entreprise que la dépense.
create or replace function public.check_expense_links()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from vehicles where id = new.vehicle_id and org_id = new.org_id) then
    raise exception 'Véhicule inconnu' using errcode = 'P0001';
  end if;
  if new.reservation_id is not null and not exists (select 1 from reservations where id = new.reservation_id and org_id = new.org_id) then
    raise exception 'Contrat inconnu' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists expenses_links on public.expenses;
create trigger expenses_links before insert or update on public.expenses
  for each row execute function check_expense_links();
revoke execute on function public.check_expense_links() from public, anon, authenticated;

alter table public.expenses enable row level security;
drop policy if exists expenses_read on public.expenses;
create policy expenses_read on public.expenses for select using (is_member(org_id));
drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses for insert
  with check (has_role(org_id, array['admin', 'direction', 'agent', 'comptable', 'mecanicien']));
drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses for update
  using (has_role(org_id, array['admin', 'direction', 'agent', 'comptable', 'mecanicien']))
  with check (has_role(org_id, array['admin', 'direction', 'agent', 'comptable', 'mecanicien']));
drop policy if exists expenses_delete on public.expenses;
create policy expenses_delete on public.expenses for delete
  using (has_role(org_id, array['admin', 'direction', 'comptable']));
