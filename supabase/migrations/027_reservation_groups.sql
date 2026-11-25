-- Yoon Fleet — dossiers de groupe : un client loue plusieurs véhicules (même catégorie ou non).
-- Chaque véhicule garde son contrat, son état des lieux et son chauffeur ; le dossier les réunit
-- pour le suivi, le relevé unique envoyé au client et l'encaissement global.

create table if not exists public.reservation_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  number text not null check (length(number) between 3 and 30),
  client_id uuid not null references public.clients (id) on delete restrict,
  label text check (label is null or length(label) <= 120),
  notes text check (notes is null or length(notes) <= 500),
  created_at timestamptz not null default now(),
  unique (org_id, number)
);
create index if not exists reservation_groups_org on public.reservation_groups (org_id);

create or replace function public.check_group_links()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from clients where id = new.client_id and org_id = new.org_id) then
    raise exception 'Client inconnu' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.check_group_links() from public, anon, authenticated;
drop trigger if exists reservation_groups_links on public.reservation_groups;
create trigger reservation_groups_links before insert or update on public.reservation_groups for each row execute function check_group_links();

alter table public.reservation_groups enable row level security;
drop policy if exists groups_read on public.reservation_groups;
create policy groups_read on public.reservation_groups for select using (is_member(org_id));
drop policy if exists groups_insert on public.reservation_groups;
create policy groups_insert on public.reservation_groups for insert with check (has_role(org_id, array['admin', 'direction', 'agent']));
drop policy if exists groups_update on public.reservation_groups;
create policy groups_update on public.reservation_groups for update
  using (has_role(org_id, array['admin', 'direction', 'agent'])) with check (has_role(org_id, array['admin', 'direction', 'agent']));
drop policy if exists groups_delete on public.reservation_groups;
create policy groups_delete on public.reservation_groups for delete using (has_role(org_id, array['admin', 'direction']));

drop trigger if exists reservation_groups_audit on public.reservation_groups;
create trigger reservation_groups_audit after insert or update or delete on public.reservation_groups for each row execute function write_audit();

-- Rattachement d'un contrat à un dossier du même loueur et du même client.
alter table public.reservations add column if not exists group_id uuid references public.reservation_groups (id) on delete set null;
create index if not exists reservations_group on public.reservations (group_id) where group_id is not null;

create or replace function public.check_reservation_group()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.group_id is not null and not exists (
    select 1 from reservation_groups where id = new.group_id and org_id = new.org_id and client_id = new.client_id
  ) then
    raise exception 'Dossier inconnu ou d''un autre client' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.check_reservation_group() from public, anon, authenticated;
drop trigger if exists reservations_group on public.reservations;
create trigger reservations_group before insert or update of group_id, client_id on public.reservations
  for each row execute function check_reservation_group();

-- Devis multi-catégories : lignes supplémentaires (même client, mêmes dates, même formule).
alter table public.quotes add column if not exists extras jsonb not null default '[]'::jsonb;
alter table public.quotes drop constraint if exists quotes_extras_shape;
alter table public.quotes add constraint quotes_extras_shape check (jsonb_typeof(extras) = 'array' and jsonb_array_length(extras) <= 10);

-- Lien public : le client peut demander plusieurs véhicules du même type.
alter table public.booking_requests add column if not exists quantity int not null default 1;
alter table public.booking_requests drop constraint if exists booking_requests_quantity;
alter table public.booking_requests add constraint booking_requests_quantity check (quantity between 1 and 20);

-- Une demande reçue ne se réécrit pas : seul son traitement change.
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
  new.transfer_kind := old.transfer_kind; new.flight_number := old.flight_number; new.flight_at := old.flight_at;
  new.quantity := old.quantity;
  return new;
end $$;
revoke execute on function public.stamp_booking_request() from public, anon, authenticated;

drop function if exists public.submit_booking_request(text, text, timestamptz, timestamptz, boolean, text, text, text, text, text, text, int, text, text, timestamptz);
create or replace function public.submit_booking_request(
  p_slug text, p_category text, p_start timestamptz, p_end timestamptz, p_with_driver boolean,
  p_name text, p_phone text, p_email text, p_message text,
  p_company_name text default null, p_company_tax_id text default null, p_passengers int default null,
  p_transfer_kind text default null, p_flight_number text default null, p_flight_at timestamptz default null,
  p_quantity int default 1
) returns uuid language plpgsql security definer set search_path = public as $$
declare o uuid; digits text; new_id uuid; must_drive boolean; flight text;
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
  if coalesce(p_quantity, 1) not between 1 and 20 then
    raise exception 'Nombre de véhicules : de 1 à 20. Au-delà, contactez directement l''agence.' using errcode = 'P0001';
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
  if p_transfer_kind is not null then
    if p_transfer_kind not in ('arrivee', 'depart') then
      raise exception 'Sens du transfert invalide.' using errcode = 'P0001';
    end if;
    flight := upper(regexp_replace(coalesce(p_flight_number, ''), '[\s-]', '', 'g'));
    if flight !~ '^([A-Z][A-Z0-9]|[0-9][A-Z]|[A-Z]{3})[0-9]{1,4}[A-Z]?$' then
      raise exception 'Indiquez le numéro de vol (par exemple AF718 ou SN205).' using errcode = 'P0001';
    end if;
    if p_flight_at is null then
      raise exception 'Indiquez l''heure du vol.' using errcode = 'P0001';
    end if;
    if abs(extract(epoch from (p_flight_at - p_start))) > 86400 then
      raise exception 'L''heure du vol et celle de la prise en charge sont à plus de 24 h d''écart : vérifiez les dates.' using errcode = 'P0001';
    end if;
    if p_transfer_kind = 'depart' and p_start > p_flight_at then
      raise exception 'La prise en charge doit avoir lieu avant le décollage.' using errcode = 'P0001';
    end if;
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
  insert into booking_requests (org_id, category, start, "end", with_driver, name, phone, email, message, company_name, company_tax_id, passengers,
                                transfer_kind, flight_number, flight_at, quantity)
  values (o, p_category, p_start, p_end, coalesce(p_with_driver, false) or must_drive or p_transfer_kind is not null, trim(p_name), trim(p_phone),
          nullif(trim(p_email), ''), nullif(trim(p_message), ''), nullif(trim(p_company_name), ''), nullif(trim(p_company_tax_id), ''), p_passengers,
          p_transfer_kind, case when p_transfer_kind is null then null else flight end, case when p_transfer_kind is null then null else p_flight_at end,
          coalesce(p_quantity, 1))
  returning id into new_id;
  return new_id;
end $$;
revoke execute on function public.submit_booking_request(text, text, timestamptz, timestamptz, boolean, text, text, text, text, text, text, int, text, text, timestamptz, int) from public;
grant execute on function public.submit_booking_request(text, text, timestamptz, timestamptz, boolean, text, text, text, text, text, text, int, text, text, timestamptz, int) to anon, authenticated;
