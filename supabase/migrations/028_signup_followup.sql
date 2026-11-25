-- Yoon Fleet — lancement 100 % digital : chaque inscription est rappelée par l'équipe TBG.
-- 1. Le gérant laisse son nom et son numéro WhatsApp à l'inscription (et la publicité d'origine).
-- 2. L'équipe TBG (table platform_staff) voit toutes les inscriptions, leur avancement et ses notes d'appel.
-- Les loueurs ne voient rien de tout cela : tables sans politique, lues par fonctions réservées.

alter table public.organizations add column if not exists contact_name text;
alter table public.organizations add column if not exists contact_phone text;
alter table public.organizations add column if not exists signup_source text;
alter table public.organizations drop constraint if exists organizations_contact_shape;
alter table public.organizations add constraint organizations_contact_shape check (
  (contact_name is null or length(contact_name) <= 120)
  and (contact_phone is null or length(contact_phone) <= 30)
  and (signup_source is null or length(signup_source) <= 120)
);

-- Équipe Yoon Fleet (TBG) : ajout à la main, par SQL.
create table if not exists public.platform_staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_staff enable row level security;

create or replace function public.is_platform_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_staff where user_id = auth.uid());
$$;
revoke execute on function public.is_platform_staff() from public, anon;
grant execute on function public.is_platform_staff() to authenticated;

-- Suivi des appels d'onboarding, un par entreprise.
create table if not exists public.org_followups (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  status text not null default 'a_appeler' check (status in ('a_appeler', 'injoignable', 'rappeler', 'onboarde', 'perdu')),
  note text check (note is null or length(note) <= 1000),
  next_call date,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
alter table public.org_followups enable row level security;

-- Inscription : nom et WhatsApp du gérant, publicité d'origine.
drop function if exists public.create_organization(text, text);
create or replace function public.create_organization(
  p_name text, p_country text default 'SN', p_contact_name text default null, p_contact_phone text default null, p_source text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid; v_email text; digits text;
begin
  if auth.uid() is null then raise exception 'non authentifié'; end if;
  if length(trim(coalesce(p_name, ''))) not between 2 and 120 then
    raise exception 'Indiquez le nom de l''entreprise (2 à 120 caractères).' using errcode = 'P0001';
  end if;
  digits := regexp_replace(coalesce(p_contact_phone, ''), '\D', '', 'g');
  if p_contact_phone is not null and length(digits) not between 8 and 15 then
    raise exception 'Indiquez un numéro WhatsApp valide.' using errcode = 'P0001';
  end if;
  if (select count(*) from memberships where user_id = auth.uid() and role = 'admin') >= 3 then
    raise exception 'Vous administrez déjà 3 entreprises. Contactez Yoon Fleet pour en ajouter.' using errcode = 'P0001';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into organizations (name, country, contact_name, contact_phone, signup_source)
  values (trim(p_name), coalesce(p_country, 'SN'), nullif(left(trim(coalesce(p_contact_name, '')), 120), ''),
          nullif(left(trim(coalesce(p_contact_phone, '')), 30), ''), nullif(left(trim(coalesce(p_source, '')), 120), ''))
    returning id into new_id;
  insert into memberships (org_id, user_id, role, email) values (new_id, auth.uid(), 'admin', lower(v_email));
  insert into rates (org_id, category, daily, weekly, monthly, driver_daily, km_per_day, extra_km, caution)
  values
    (new_id, 'Citadine', 25000, 22000, 18000, 10000, 250, 100, 150000),
    (new_id, 'Berline', 35000, 31000, 25000, 12000, 250, 120, 200000),
    (new_id, 'SUV', 45000, 40000, 32000, 15000, 250, 150, 300000),
    (new_id, '4x4', 60000, 54000, 45000, 15000, 250, 200, 400000),
    (new_id, 'Minibus', 75000, 68000, 55000, 20000, 300, 200, 400000);
  insert into org_followups (org_id) values (new_id);
  return new_id;
end $$;
revoke execute on function public.create_organization(text, text, text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text, text, text) to authenticated;

-- Tableau des inscriptions et essais, pour l'équipe TBG seulement.
create or replace function public.platform_signups()
returns table (
  org_id uuid, name text, country text, created_at timestamptz, plan text, trial_ends_at timestamptz, paid_until timestamptz,
  contact_name text, contact_phone text, admin_email text, signup_source text,
  vehicles int, clients int, reservations int, members int, last_activity timestamptz,
  status text, note text, next_call date, followup_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_staff() then
    raise exception 'Réservé à l''équipe Yoon Fleet.' using errcode = '42501';
  end if;
  return query
  select o.id, o.name, o.country, o.created_at, o.plan, o.trial_ends_at, o.paid_until,
         o.contact_name, o.contact_phone,
         (select m.email from memberships m where m.org_id = o.id and m.role = 'admin' order by m.created_at nulls last limit 1),
         o.signup_source,
         (select count(*)::int from vehicles v where v.org_id = o.id),
         (select count(*)::int from clients c where c.org_id = o.id),
         (select count(*)::int from reservations r where r.org_id = o.id),
         (select count(*)::int from memberships m where m.org_id = o.id),
         (select max(r.created_at) from reservations r where r.org_id = o.id),
         coalesce(f.status, 'a_appeler'), f.note, f.next_call, f.updated_at
  from organizations o
  left join org_followups f on f.org_id = o.id
  order by o.created_at desc nulls last
  limit 1000;
end $$;
revoke execute on function public.platform_signups() from public, anon;
grant execute on function public.platform_signups() to authenticated;

create or replace function public.platform_set_followup(p_org uuid, p_status text, p_note text, p_next_call date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_staff() then
    raise exception 'Réservé à l''équipe Yoon Fleet.' using errcode = '42501';
  end if;
  if p_status not in ('a_appeler', 'injoignable', 'rappeler', 'onboarde', 'perdu') then
    raise exception 'Statut inconnu.' using errcode = 'P0001';
  end if;
  insert into org_followups (org_id, status, note, next_call, updated_at, updated_by)
  values (p_org, p_status, nullif(left(trim(coalesce(p_note, '')), 1000), ''), p_next_call, now(), auth.uid())
  on conflict (org_id) do update set status = excluded.status, note = excluded.note, next_call = excluded.next_call,
    updated_at = now(), updated_by = auth.uid();
end $$;
revoke execute on function public.platform_set_followup(uuid, text, text, date) from public, anon;
grant execute on function public.platform_set_followup(uuid, text, text, date) to authenticated;
