-- Yoon Fleet — réservation en ligne.
-- Chaque entreprise peut ouvrir une page publique /r/<adresse>. Les visiteurs (non connectés)
-- voient les catégories, les prix et la disponibilité, et envoient une demande. Ils ne lisent
-- jamais les tables : tout passe par trois fonctions qui ne renvoient que l'utile.

alter table public.organizations add column if not exists booking_slug text;
alter table public.organizations add column if not exists booking_enabled boolean not null default false;
alter table public.organizations drop constraint if exists organizations_booking_slug_format;
alter table public.organizations add constraint organizations_booking_slug_format
  check (booking_slug is null or booking_slug ~ '^[a-z0-9][a-z0-9-]{2,39}$');
create unique index if not exists organizations_booking_slug_unique on public.organizations (booking_slug);

create table if not exists public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  category text not null,
  start timestamptz not null,
  "end" timestamptz not null,
  with_driver boolean not null default false,
  name text not null check (length(name) between 2 and 120),
  phone text not null check (length(phone) between 6 and 30),
  email text check (email is null or length(email) <= 160),
  message text check (message is null or length(message) <= 1000),
  status text not null default 'nouvelle' check (status in ('nouvelle', 'acceptee', 'refusee')),
  reservation_id uuid references public.reservations (id) on delete set null,
  decline_reason text check (decline_reason is null or length(decline_reason) <= 500),
  handled_by uuid references auth.users (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  check ("end" > start)
);
create index if not exists booking_requests_org on public.booking_requests (org_id, status, created_at desc);

alter table public.booking_requests enable row level security;
drop policy if exists booking_requests_read on public.booking_requests;
create policy booking_requests_read on public.booking_requests for select
  using (has_role(org_id, array['admin', 'direction', 'agent']));
drop policy if exists booking_requests_update on public.booking_requests;
create policy booking_requests_update on public.booking_requests for update
  using (has_role(org_id, array['admin', 'direction', 'agent']))
  with check (has_role(org_id, array['admin', 'direction', 'agent']));
drop policy if exists booking_requests_delete on public.booking_requests;
create policy booking_requests_delete on public.booking_requests for delete
  using (has_role(org_id, array['admin']));
-- Pas de règle d'insertion : les demandes arrivent uniquement par submit_booking_request.

create or replace function public.stamp_booking_request()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status then
    new.handled_by := auth.uid();
    new.handled_at := now();
  end if;
  -- Les champs saisis par le client ne se modifient pas après coup.
  new.org_id := old.org_id; new.category := old.category; new.start := old.start; new."end" := old."end";
  new.with_driver := old.with_driver; new.name := old.name; new.phone := old.phone; new.email := old.email;
  new.message := old.message; new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists booking_requests_stamp on public.booking_requests;
create trigger booking_requests_stamp before update on public.booking_requests
  for each row execute function stamp_booking_request();

-- ---------------------------------------------------------------- fonctions publiques

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
          ) mm), '[]'::jsonb)
      ) order by r.daily)
      from rates r
      where r.org_id = o.id
        and exists (select 1 from vehicles v where v.org_id = o.id and v.category = r.category and not v.out_of_service)
    ), '[]'::jsonb)
  )
  from organizations o
  where o.booking_slug = lower(p_slug) and o.booking_enabled;
$$;

create or replace function public.public_availability(p_slug text, p_start timestamptz, p_end timestamptz)
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
    ) as n
    from vehicles v
    where v.org_id = o and not v.out_of_service
    group by v.category
  ) t;
  return out;
end $$;

create or replace function public.submit_booking_request(
  p_slug text, p_category text, p_start timestamptz, p_end timestamptz, p_with_driver boolean,
  p_name text, p_phone text, p_email text, p_message text
) returns uuid language plpgsql security definer set search_path = public as $$
declare o uuid; digits text; new_id uuid;
begin
  select id into o from organizations where booking_slug = lower(p_slug) and booking_enabled;
  if o is null then
    raise exception 'Cette page de réservation n''est pas disponible.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from rates where org_id = o and category = p_category) then
    raise exception 'Choisissez un type de véhicule.' using errcode = 'P0001';
  end if;
  if p_start is null or p_end is null or p_start < now() - interval '1 hour' then
    raise exception 'La date de départ est déjà passée.' using errcode = 'P0001';
  end if;
  if p_end <= p_start then
    raise exception 'La date de retour doit être après la date de départ.' using errcode = 'P0001';
  end if;
  if p_end - p_start > interval '180 days' then
    raise exception 'Pour plus de 6 mois, contactez directement l''agence.' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_name, ''))) not between 2 and 120 then
    raise exception 'Indiquez votre nom.' using errcode = 'P0001';
  end if;
  digits := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if length(digits) not between 8 and 15 then
    raise exception 'Indiquez un numéro de téléphone valide.' using errcode = 'P0001';
  end if;
  if nullif(trim(p_email), '') is not null and trim(p_email) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Adresse email invalide.' using errcode = 'P0001';
  end if;
  if length(coalesce(p_message, '')) > 1000 then
    raise exception 'Message trop long (1 000 caractères maximum).' using errcode = 'P0001';
  end if;
  -- Limites contre les envois en masse.
  if (select count(*) from booking_requests
      where org_id = o and status = 'nouvelle' and created_at > now() - interval '24 hours'
        and right(regexp_replace(phone, '\D', '', 'g'), 9) = right(digits, 9)) >= 3 then
    raise exception 'Vous avez déjà plusieurs demandes en attente : l''agence va vous recontacter.' using errcode = 'P0001';
  end if;
  if (select count(*) from booking_requests where org_id = o and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Trop de demandes en ce moment, réessayez dans un instant.' using errcode = 'P0001';
  end if;
  insert into booking_requests (org_id, category, start, "end", with_driver, name, phone, email, message)
  values (o, p_category, p_start, p_end, coalesce(p_with_driver, false), trim(p_name), trim(p_phone),
          nullif(trim(p_email), ''), nullif(trim(p_message), ''))
  returning id into new_id;
  return new_id;
end $$;

revoke execute on function public.public_booking_info(text) from public;
revoke execute on function public.public_availability(text, timestamptz, timestamptz) from public;
revoke execute on function public.submit_booking_request(text, text, timestamptz, timestamptz, boolean, text, text, text, text) from public;
grant execute on function public.public_booking_info(text) to anon, authenticated;
grant execute on function public.public_availability(text, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.submit_booking_request(text, text, timestamptz, timestamptz, boolean, text, text, text, text) to anon, authenticated;
revoke execute on function public.stamp_booking_request() from public, anon, authenticated;
