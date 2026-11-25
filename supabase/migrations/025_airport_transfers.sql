-- Yoon Fleet — transferts aéroport : vol du client (arrivée ou départ) sur les réservations
-- et sur les demandes reçues par la page de réservation en ligne.

alter table public.reservations
  add column if not exists transfer_kind text check (transfer_kind in ('arrivee', 'depart')),
  add column if not exists flight_number text check (flight_number is null or flight_number ~ '^([A-Z][A-Z0-9]|[0-9][A-Z]|[A-Z]{3})[0-9]{1,4}[A-Z]?$'),
  add column if not exists flight_at timestamptz;
alter table public.reservations drop constraint if exists reservations_flight_complete;
alter table public.reservations add constraint reservations_flight_complete
  check (transfer_kind is null or (flight_number is not null and flight_at is not null));

alter table public.booking_requests
  add column if not exists transfer_kind text check (transfer_kind in ('arrivee', 'depart')),
  add column if not exists flight_number text check (flight_number is null or flight_number ~ '^([A-Z][A-Z0-9]|[0-9][A-Z]|[A-Z]{3})[0-9]{1,4}[A-Z]?$'),
  add column if not exists flight_at timestamptz;

drop function if exists public.submit_booking_request(text, text, timestamptz, timestamptz, boolean, text, text, text, text, text, text, int);
create or replace function public.submit_booking_request(
  p_slug text, p_category text, p_start timestamptz, p_end timestamptz, p_with_driver boolean,
  p_name text, p_phone text, p_email text, p_message text,
  p_company_name text default null, p_company_tax_id text default null, p_passengers int default null,
  p_transfer_kind text default null, p_flight_number text default null, p_flight_at timestamptz default null
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
  -- Transfert aéroport : vol obligatoire et cohérent avec la prise en charge.
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
                                transfer_kind, flight_number, flight_at)
  values (o, p_category, p_start, p_end, coalesce(p_with_driver, false) or must_drive or p_transfer_kind is not null, trim(p_name), trim(p_phone),
          nullif(trim(p_email), ''), nullif(trim(p_message), ''), nullif(trim(p_company_name), ''), nullif(trim(p_company_tax_id), ''), p_passengers,
          p_transfer_kind, case when p_transfer_kind is null then null else flight end, case when p_transfer_kind is null then null else p_flight_at end)
  returning id into new_id;
  return new_id;
end $$;
revoke execute on function public.submit_booking_request(text, text, timestamptz, timestamptz, boolean, text, text, text, text, text, text, int, text, text, timestamptz) from public;
grant execute on function public.submit_booking_request(text, text, timestamptz, timestamptz, boolean, text, text, text, text, text, text, int, text, text, timestamptz) to anon, authenticated;
