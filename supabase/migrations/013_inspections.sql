-- Yoon Fleet — état des lieux de départ et de retour (photos par zone, compteur, carburant, signatures).
create table if not exists public.inspections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  kind text not null check (kind in ('depart', 'retour')),
  mileage int not null check (mileage >= 0),
  fuel_quarters int not null check (fuel_quarters between 0 and 4),
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  signature text check (signature is null or length(signature) < 300000),
  signer_name text not null check (length(signer_name) between 1 and 120),
  agent_signature text check (agent_signature is null or length(agent_signature) < 300000),
  notes text check (notes is null or length(notes) <= 2000),
  done_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (reservation_id, kind)
);
create index if not exists inspections_org on public.inspections (org_id, reservation_id);

-- Un état des lieux signé fait foi : il ne se modifie ni ne se supprime.
alter table public.inspections enable row level security;
drop policy if exists inspections_read on public.inspections;
create policy inspections_read on public.inspections for select using (is_member(org_id));
drop policy if exists inspections_insert on public.inspections;
create policy inspections_insert on public.inspections for insert
  with check (
    has_role(org_id, array['admin', 'direction', 'agent', 'mecanicien'])
    and exists (select 1 from public.reservations r where r.id = reservation_id and r.org_id = inspections.org_id)
  );

-- Photos des états des lieux : espace PRIVÉ, lecture par liens temporaires réservée aux membres.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inspection-photos', 'inspection-photos', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists inspection_photos_read on storage.objects;
create policy inspection_photos_read on storage.objects for select to authenticated
  using (
    bucket_id = 'inspection-photos'
    and (storage.foldername(name))[1] in (select org_id::text from public.memberships where user_id = auth.uid())
  );
drop policy if exists inspection_photos_insert on storage.objects;
create policy inspection_photos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'inspection-photos'
    and (storage.foldername(name))[1] in (
      select org_id::text from public.memberships
      where user_id = auth.uid() and role in ('admin', 'direction', 'agent', 'mecanicien'))
  );
