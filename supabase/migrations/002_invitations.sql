-- Yoon Fleet — invitations et gestion de l'équipe (V1)
-- L'administrateur invite une adresse email avec un rôle. La personne crée son compte
-- avec cette adresse ; dès que l'email est confirmé, elle rejoint l'entreprise.

alter table public.memberships add column if not exists email text;
update public.memberships m set email = u.email from auth.users u where u.id = m.user_id and m.email is null;

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null check (role in ('admin', 'direction', 'agent', 'comptable', 'mecanicien')),
  token uuid not null default gen_random_uuid() unique,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz
);
create unique index if not exists invitations_pending_unique
  on public.invitations (org_id, lower(email)) where accepted_at is null;

alter table public.invitations enable row level security;
drop policy if exists invitations_admin on public.invitations;
create policy invitations_admin on public.invitations for all
  using (has_role(org_id, array['admin'])) with check (has_role(org_id, array['admin']));

-- Contrôles à la création d'une invitation : déjà membre, limite d'utilisateurs de la formule.
create or replace function public.check_invitation()
returns trigger language plpgsql security definer set search_path = public as $$
declare p text; n int;
begin
  new.email := lower(trim(new.email));
  new.invited_by := auth.uid();
  if exists (select 1 from memberships where org_id = new.org_id and lower(email) = new.email) then
    raise exception 'Cette personne fait déjà partie de l''équipe' using errcode = 'P0001';
  end if;
  select plan into p from organizations where id = new.org_id;
  if p = 'essentiel' then
    select (select count(*) from memberships where org_id = new.org_id)
         + (select count(*) from invitations where org_id = new.org_id and accepted_at is null and expires_at > now())
      into n;
    if n >= 3 then
      raise exception 'La formule Essentiel est limitée à 3 utilisateurs' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists invitations_check on public.invitations;
create trigger invitations_check before insert on public.invitations
  for each row execute function check_invitation();

-- À la connexion : rejoint les entreprises qui ont invité l'adresse (email confirmé uniquement).
create or replace function public.accept_invitations()
returns int language plpgsql security definer set search_path = public as $$
declare v_email text; n int;
begin
  select lower(email) into v_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if v_email is null then return 0; end if;
  insert into memberships (org_id, user_id, role, email)
    select org_id, auth.uid(), role, v_email from invitations
    where lower(email) = v_email and accepted_at is null and expires_at > now()
    on conflict (org_id, user_id) do nothing;
  get diagnostics n = row_count;
  update invitations set accepted_at = now()
    where lower(email) = v_email and accepted_at is null and expires_at > now();
  return n;
end $$;

-- L'email du créateur est enregistré avec son rôle d'administrateur.
create or replace function public.create_organization(p_name text, p_country text default 'SN')
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid; v_email text;
begin
  if auth.uid() is null then raise exception 'non authentifié'; end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into organizations (name, country) values (p_name, coalesce(p_country, 'SN'))
    returning id into new_id;
  insert into memberships (org_id, user_id, role, email) values (new_id, auth.uid(), 'admin', lower(v_email));
  insert into rates (org_id, category, daily, weekly, monthly, driver_daily, km_per_day, extra_km, caution)
  values
    (new_id, 'Citadine', 25000, 22000, 18000, 10000, 250, 100, 150000),
    (new_id, 'Berline', 35000, 31000, 25000, 12000, 250, 120, 200000),
    (new_id, 'SUV', 45000, 40000, 32000, 15000, 250, 150, 300000),
    (new_id, '4x4', 60000, 54000, 45000, 15000, 250, 200, 400000),
    (new_id, 'Minibus', 75000, 68000, 55000, 20000, 300, 200, 400000);
  return new_id;
end $$;

-- Une entreprise garde toujours au moins un administrateur.
create or replace function public.keep_one_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin') then
    if not exists (
      select 1 from memberships where org_id = old.org_id and role = 'admin' and user_id <> old.user_id
    ) and exists (select 1 from organizations where id = old.org_id) then
      raise exception 'L''entreprise doit garder au moins un administrateur' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists memberships_keep_admin on public.memberships;
create trigger memberships_keep_admin before update or delete on public.memberships
  for each row execute function keep_one_admin();

revoke execute on function public.accept_invitations() from public, anon;
grant execute on function public.accept_invitations() to authenticated;
revoke execute on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;
revoke execute on function public.check_invitation() from public, anon, authenticated;
revoke execute on function public.keep_one_admin() from public, anon, authenticated;
