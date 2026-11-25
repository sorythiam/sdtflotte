-- Yoon Fleet — absences des chauffeurs (congé, repos, maladie, formation) :
-- un chauffeur absent ne peut pas être affecté à une mission.

create table if not exists public.driver_absences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  driver_id uuid not null references public.drivers (id) on delete cascade,
  kind text not null default 'conge' check (kind in ('conge', 'repos', 'maladie', 'formation', 'autre')),
  start_date date not null,
  end_date date not null,
  note text check (note is null or length(note) <= 200),
  created_at timestamptz not null default now(),
  check (end_date >= start_date and end_date - start_date <= 366)
);
create index if not exists driver_absences_driver on public.driver_absences (driver_id, start_date);

create or replace function public.check_driver_absence()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from drivers where id = new.driver_id and org_id = new.org_id) then
    raise exception 'Chauffeur inconnu' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.check_driver_absence() from public, anon, authenticated;
drop trigger if exists driver_absences_links on public.driver_absences;
create trigger driver_absences_links before insert or update on public.driver_absences for each row execute function check_driver_absence();

alter table public.driver_absences enable row level security;
drop policy if exists driver_abs_read on public.driver_absences;
create policy driver_abs_read on public.driver_absences for select using (is_member(org_id));
drop policy if exists driver_abs_insert on public.driver_absences;
create policy driver_abs_insert on public.driver_absences for insert with check (has_role(org_id, array['admin', 'direction', 'agent']));
drop policy if exists driver_abs_update on public.driver_absences;
create policy driver_abs_update on public.driver_absences for update using (has_role(org_id, array['admin', 'direction', 'agent']));
drop policy if exists driver_abs_delete on public.driver_absences;
create policy driver_abs_delete on public.driver_absences for delete using (has_role(org_id, array['admin', 'direction', 'agent']));

drop trigger if exists driver_absences_audit on public.driver_absences;
create trigger driver_absences_audit after insert or update or delete on public.driver_absences for each row execute function write_audit();
