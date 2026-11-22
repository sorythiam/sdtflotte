-- Yoon Fleet — loueurs touristiques : places et bagages, chauffeurs, forfaits et demi-journée,
-- prolongation des contrats (avenants), fiche véhicule complète.

-- Véhicules : capacité, chauffeur obligatoire, châssis, scans des documents (espace privé).
alter table public.vehicles
  add column if not exists seats int check (seats is null or seats between 1 and 99),
  add column if not exists luggage int check (luggage is null or luggage between 0 and 99),
  add column if not exists driver_required boolean not null default false,
  add column if not exists vin text check (vin is null or length(vin) <= 40),
  add column if not exists documents jsonb not null default '{}'::jsonb check (jsonb_typeof(documents) = 'object');

-- Tarifs : prix de la demi-journée (0 = pas de demi-journée).
alter table public.rates
  add column if not exists half_day int not null default 0 check (half_day >= 0);

-- Chauffeurs de l'entreprise.
create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(name) between 2 and 120),
  phone text not null check (length(phone) between 6 and 30),
  license_number text check (license_number is null or length(license_number) <= 40),
  license_category text check (license_category is null or length(license_category) <= 20),
  license_expiry date,
  active boolean not null default true,
  notes text check (notes is null or length(notes) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists drivers_org on public.drivers (org_id);
alter table public.drivers enable row level security;
drop policy if exists drivers_read on public.drivers;
create policy drivers_read on public.drivers for select using (is_member(org_id));
drop policy if exists drivers_write on public.drivers;
create policy drivers_write on public.drivers for insert with check (has_role(org_id, array['admin', 'direction', 'agent']));
drop policy if exists drivers_update on public.drivers;
create policy drivers_update on public.drivers for update
  using (has_role(org_id, array['admin', 'direction', 'agent'])) with check (has_role(org_id, array['admin', 'direction', 'agent']));
drop policy if exists drivers_delete on public.drivers;
create policy drivers_delete on public.drivers for delete using (has_role(org_id, array['admin', 'direction']));

-- Forfaits : transferts et excursions à prix fixe, toujours avec chauffeur.
create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  label text not null check (length(label) between 2 and 120),
  category text not null check (length(category) between 1 and 60),
  price int not null check (price > 0 and price <= 100000000),
  hours int not null default 4 check (hours between 1 and 72),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists packages_org on public.packages (org_id);
alter table public.packages enable row level security;
drop policy if exists packages_read on public.packages;
create policy packages_read on public.packages for select using (is_member(org_id));
drop policy if exists packages_insert on public.packages;
create policy packages_insert on public.packages for insert with check (has_role(org_id, array['admin', 'direction']));
drop policy if exists packages_update on public.packages;
create policy packages_update on public.packages for update
  using (has_role(org_id, array['admin', 'direction'])) with check (has_role(org_id, array['admin', 'direction']));
drop policy if exists packages_delete on public.packages;
create policy packages_delete on public.packages for delete using (has_role(org_id, array['admin', 'direction']));

-- Réservations : passagers, chauffeur nommé, formule, frais de mission, conditions du voyage.
alter table public.reservations
  add column if not exists passengers int check (passengers is null or passengers between 1 and 99),
  add column if not exists driver_id uuid references public.drivers (id) on delete set null,
  add column if not exists formula text not null default 'jour' check (formula in ('jour', 'demi_journee', 'forfait')),
  add column if not exists package_label text check (package_label is null or length(package_label) <= 120),
  add column if not exists mission_fees int not null default 0 check (mission_fees >= 0),
  add column if not exists fuel_included boolean not null default false,
  add column if not exists itinerary text check (itinerary is null or length(itinerary) <= 500),
  add column if not exists cross_border text check (cross_border is null or length(cross_border) <= 120);

create or replace function public.check_reservation_driver()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.driver_id is not null and not exists (select 1 from drivers where id = new.driver_id and org_id = new.org_id) then
    raise exception 'Chauffeur inconnu' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists reservations_driver on public.reservations;
create trigger reservations_driver before insert or update of driver_id on public.reservations
  for each row execute function check_reservation_driver();
revoke execute on function public.check_reservation_driver() from public, anon, authenticated;

-- Avenants : chaque changement de dates ou de prix d'un contrat est tracé, sans modification possible.
create table if not exists public.reservation_changes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  old_start timestamptz not null,
  old_end timestamptz not null,
  new_start timestamptz not null,
  new_end timestamptz not null,
  old_total int not null,
  new_total int not null,
  reason text check (reason is null or length(reason) <= 300),
  changed_by text check (changed_by is null or length(changed_by) <= 160),
  created_at timestamptz not null default now()
);
create index if not exists reservation_changes_res on public.reservation_changes (reservation_id);
alter table public.reservation_changes enable row level security;
drop policy if exists reservation_changes_read on public.reservation_changes;
create policy reservation_changes_read on public.reservation_changes for select using (is_member(org_id));
drop policy if exists reservation_changes_insert on public.reservation_changes;
create policy reservation_changes_insert on public.reservation_changes for insert
  with check (
    has_role(org_id, array['admin', 'direction', 'agent'])
    and exists (select 1 from reservations r where r.id = reservation_id and r.org_id = reservation_changes.org_id)
  );

-- Demandes en ligne : nombre de passagers.
alter table public.booking_requests
  add column if not exists passengers int check (passengers is null or passengers between 1 and 99);

create or replace function public.stamp_booking_request()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status then
    new.handled_by := auth.uid();
    new.handled_at := now();
  end if;
  new.org_id := old.org_id; new.category := old.category; new.start := old.start; new."end" := old."end";
  new.with_driver := old.with_driver; new.name := old.name; new.phone := old.phone; new.email := old.email;
  new.message := old.message; new.created_at := old.created_at;
  new.company_name := old.company_name; new.company_tax_id := old.company_tax_id; new.passengers := old.passengers;
  return new;
end $$;

-- Page publique : places et bagages par catégorie, chauffeur obligatoire.
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
        'seats', (select max(v.seats) from vehicles v where v.org_id = o.id and v.category = r.category and not v.out_of_service),
        'luggage', (select max(v.luggage) from vehicles v where v.org_id = o.id and v.category = r.category and not v.out_of_service),
        'driverRequired', coalesce((select bool_and(v.driver_required) from vehicles v where v.org_id = o.id and v.category = r.category and not v.out_of_service), false),
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

-- Disponibilité : seuls les véhicules assez grands comptent quand le nombre de passagers est donné.
drop function if exists public.public_availability(text, timestamptz, timestamptz);
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
      and (p_passengers is null or v.seats is null or v.seats >= p_passengers)
    ) as n
    from vehicles v
    where v.org_id = o and not v.out_of_service
    group by v.category
  ) t;
  return out;
end $$;
revoke execute on function public.public_availability(text, timestamptz, timestamptz, int) from public;
grant execute on function public.public_availability(text, timestamptz, timestamptz, int) to anon, authenticated;

drop function if exists public.submit_booking_request(text, text, timestamptz, timestamptz, boolean, text, text, text, text, text, text);
create or replace function public.submit_booking_request(
  p_slug text, p_category text, p_start timestamptz, p_end timestamptz, p_with_driver boolean,
  p_name text, p_phone text, p_email text, p_message text,
  p_company_name text default null, p_company_tax_id text default null, p_passengers int default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare o uuid; digits text; new_id uuid; must_drive boolean;
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
  if p_passengers is not null and p_passengers not between 1 and 99 then
    raise exception 'Nombre de passagers invalide.' using errcode = 'P0001';
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
  if p_company_name is not null and length(trim(p_company_name)) not between 2 and 160 then
    raise exception 'Indiquez le nom de l''entreprise.' using errcode = 'P0001';
  end if;
  if length(coalesce(p_company_tax_id, '')) > 40 then
    raise exception 'Identifiant fiscal trop long.' using errcode = 'P0001';
  end if;
  if (select count(*) from booking_requests
      where org_id = o and status = 'nouvelle' and created_at > now() - interval '24 hours'
        and right(regexp_replace(phone, '\D', '', 'g'), 9) = right(digits, 9)) >= 3 then
    raise exception 'Vous avez déjà plusieurs demandes en attente : l''agence va vous recontacter.' using errcode = 'P0001';
  end if;
  if (select count(*) from booking_requests where org_id = o and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Trop de demandes en ce moment, réessayez dans un instant.' using errcode = 'P0001';
  end if;
  select coalesce(bool_and(driver_required), false) into must_drive from vehicles
    where org_id = o and category = p_category and not out_of_service;
  insert into booking_requests (org_id, category, start, "end", with_driver, name, phone, email, message, company_name, company_tax_id, passengers)
  values (o, p_category, p_start, p_end, coalesce(p_with_driver, false) or must_drive, trim(p_name), trim(p_phone),
          nullif(trim(p_email), ''), nullif(trim(p_message), ''), nullif(trim(p_company_name), ''), nullif(trim(p_company_tax_id), ''), p_passengers)
  returning id into new_id;
  return new_id;
end $$;
revoke execute on function public.submit_booking_request(text, text, timestamptz, timestamptz, boolean, text, text, text, text, text, text, int) from public;
grant execute on function public.submit_booking_request(text, text, timestamptz, timestamptz, boolean, text, text, text, text, text, text, int) to anon, authenticated;
