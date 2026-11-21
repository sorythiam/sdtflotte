-- Yoon Fleet — réservation en ligne pour le compte d'une entreprise.
alter table public.booking_requests
  add column if not exists company_name text check (company_name is null or length(company_name) between 2 and 160),
  add column if not exists company_tax_id text check (company_tax_id is null or length(company_tax_id) <= 40);

-- Le déclencheur protège aussi ces champs saisis par le client.
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
  new.company_name := old.company_name; new.company_tax_id := old.company_tax_id;
  return new;
end $$;

drop function if exists public.submit_booking_request(text, text, timestamptz, timestamptz, boolean, text, text, text, text);

create or replace function public.submit_booking_request(
  p_slug text, p_category text, p_start timestamptz, p_end timestamptz, p_with_driver boolean,
  p_name text, p_phone text, p_email text, p_message text,
  p_company_name text default null, p_company_tax_id text default null
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
  if p_company_name is not null and length(trim(p_company_name)) not between 2 and 160 then
    raise exception 'Indiquez le nom de l''entreprise.' using errcode = 'P0001';
  end if;
  if length(coalesce(p_company_tax_id, '')) > 40 then
    raise exception 'Identifiant fiscal trop long.' using errcode = 'P0001';
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
  insert into booking_requests (org_id, category, start, "end", with_driver, name, phone, email, message, company_name, company_tax_id)
  values (o, p_category, p_start, p_end, coalesce(p_with_driver, false), trim(p_name), trim(p_phone),
          nullif(trim(p_email), ''), nullif(trim(p_message), ''), nullif(trim(p_company_name), ''), nullif(trim(p_company_tax_id), ''))
  returning id into new_id;
  return new_id;
end $$;

revoke execute on function public.submit_booking_request(text, text, timestamptz, timestamptz, boolean, text, text, text, text, text, text) from public;
grant execute on function public.submit_booking_request(text, text, timestamptz, timestamptz, boolean, text, text, text, text, text, text) to anon, authenticated;
