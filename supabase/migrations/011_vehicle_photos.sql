-- Yoon Fleet — photos des véhicules, montrées sur la page de réservation en ligne.
alter table public.vehicles add column if not exists photos text[] not null default '{}';
alter table public.vehicles drop constraint if exists vehicles_photos_max;
alter table public.vehicles add constraint vehicles_photos_max check (cardinality(photos) <= 8);

-- Espace de stockage public en lecture (les photos s'affichent sans compte),
-- 2 Mo par fichier (les photos sont réduites dans le navigateur avant l'envoi).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vehicle-photos', 'vehicle-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Écriture : uniquement dans le dossier de son entreprise (<org_id>/…), pour les profils qui gèrent les véhicules.
drop policy if exists vehicle_photos_insert on storage.objects;
create policy vehicle_photos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] in (
      select org_id::text from public.memberships
      where user_id = auth.uid() and role in ('admin', 'direction', 'agent', 'mecanicien'))
  );
drop policy if exists vehicle_photos_delete on storage.objects;
create policy vehicle_photos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] in (
      select org_id::text from public.memberships
      where user_id = auth.uid() and role in ('admin', 'direction', 'agent', 'mecanicien'))
  );

-- Page publique : photos de chaque catégorie, couvertures d'abord, 8 au plus.
create or replace function public.public_booking_info(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'name', coalesce(nullif(o.contract->>'legalName', ''), o.name),
    'logo', o.contract->>'logo',
    'phone', coalesce(o.contract->>'phone', ''),
    'email', coalesce(o.contract->>'email', ''),
    'address', coalesce(o.contract->>'address', ''),
    'city', coalesce(o.contract->>'city', ''),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', r.category, 'daily', r.daily, 'weekly', r.weekly, 'monthly', r.monthly,
        'driverDaily', r.driver_daily, 'kmPerDay', r.km_per_day, 'extraKm', r.extra_km, 'caution', r.caution,
        'vehicles', (select count(*) from vehicles v where v.org_id = o.id and v.category = r.category and not v.out_of_service),
        'models', coalesce((
          select jsonb_agg(m) from (
            select distinct v.brand || ' ' || v.model as m from vehicles v
            where v.org_id = o.id and v.category = r.category and not v.out_of_service
            order by 1 limit 3
          ) mm), '[]'::jsonb),
        'photos', coalesce((
          select jsonb_agg(b.p order by b.k, b.n) from (
            select a.p, min(a.k) as k, min(a.n) as n from (
              select v.photos[1] as p, 0 as k, v.plate as n from vehicles v
              where v.org_id = o.id and v.category = r.category and not v.out_of_service and cardinality(v.photos) > 0
              union all
              select u.p, 1, v.plate from vehicles v, unnest(v.photos[2:]) as u(p)
              where v.org_id = o.id and v.category = r.category and not v.out_of_service
            ) a group by a.p order by 2, 3 limit 8
          ) b), '[]'::jsonb)
      ) order by r.daily)
      from rates r
      where r.org_id = o.id
        and exists (select 1 from vehicles v where v.org_id = o.id and v.category = r.category and not v.out_of_service)
    ), '[]'::jsonb)
  )
  from organizations o
  where o.booking_slug = lower(p_slug) and o.booking_enabled;
$$;
