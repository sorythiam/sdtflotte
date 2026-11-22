-- Yoon Fleet — vérification du client : pièces d'identité et permis (avec photos privées),
-- validation par un agent, journal des incidents.

alter table public.clients
  add column if not exists id_type text check (id_type is null or id_type in ('cni', 'passeport', 'carte_cedeao', 'carte_sejour', 'autre')),
  add column if not exists id_expiry date,
  add column if not exists birth_date date,
  add column if not exists license_number text check (license_number is null or length(license_number) <= 40),
  add column if not exists license_category text check (license_category is null or length(license_category) <= 20),
  add column if not exists documents jsonb not null default '{}'::jsonb check (jsonb_typeof(documents) = 'object'),
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by text check (verified_by is null or length(verified_by) <= 160),
  add column if not exists score_reason text check (score_reason is null or length(score_reason) <= 500);

-- Journal des incidents d'un client (retard, dégâts, impayé, accident, amende…).
create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  reservation_id uuid references public.reservations (id) on delete set null,
  kind text not null check (kind in ('retard', 'dommage', 'impaye', 'accident', 'amende', 'comportement', 'autre')),
  severity text not null default 'mineur' check (severity in ('mineur', 'grave')),
  occurred_on date not null,
  amount int not null default 0 check (amount >= 0),
  note text not null check (length(note) between 1 and 1000),
  created_by text check (created_by is null or length(created_by) <= 160),
  created_at timestamptz not null default now()
);
create index if not exists incidents_org_client on public.incidents (org_id, client_id);

alter table public.incidents enable row level security;
drop policy if exists incidents_read on public.incidents;
create policy incidents_read on public.incidents for select using (is_member(org_id));
drop policy if exists incidents_insert on public.incidents;
create policy incidents_insert on public.incidents for insert
  with check (
    has_role(org_id, array['admin', 'direction', 'agent', 'mecanicien'])
    and exists (select 1 from public.clients c where c.id = client_id and c.org_id = incidents.org_id)
    and (reservation_id is null or exists (select 1 from public.reservations r where r.id = reservation_id and r.org_id = incidents.org_id))
  );
-- Seule la direction peut retirer un incident saisi par erreur ; pas de modification.
drop policy if exists incidents_delete on public.incidents;
create policy incidents_delete on public.incidents for delete using (has_role(org_id, array['admin', 'direction']));

-- Pièces des clients : espace PRIVÉ, lecture par liens temporaires, réservée à l'accueil et à la direction.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-documents', 'client-documents', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists client_docs_read on storage.objects;
create policy client_docs_read on storage.objects for select to authenticated
  using (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] in (
      select org_id::text from public.memberships
      where user_id = auth.uid() and role in ('admin', 'direction', 'agent'))
  );
drop policy if exists client_docs_insert on storage.objects;
create policy client_docs_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] in (
      select org_id::text from public.memberships
      where user_id = auth.uid() and role in ('admin', 'direction', 'agent'))
  );
drop policy if exists client_docs_delete on storage.objects;
create policy client_docs_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] in (
      select org_id::text from public.memberships
      where user_id = auth.uid() and role in ('admin', 'direction', 'agent'))
  );
