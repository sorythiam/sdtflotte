-- Yoon Fleet — durcissement après revue de sécurité.
-- 1. Paiements : un paiement enregistré ne se modifie plus ; seule la direction peut supprimer une saisie erronée (tracée au journal).
-- 2. Suppression des réservations, clients et véhicules réservée à la direction (les agents annulent, ils ne suppriment pas).
-- 3. Création d'entreprises limitée à 3 par compte, nom contrôlé.

drop policy if exists payments_write on public.payments;
drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments for insert
  with check (has_role(org_id, array['admin', 'direction', 'agent', 'comptable']));
drop policy if exists payments_delete on public.payments;
create policy payments_delete on public.payments for delete using (has_role(org_id, array['admin', 'direction']));

drop policy if exists reservations_write on public.reservations;
drop policy if exists reservations_insert on public.reservations;
create policy reservations_insert on public.reservations for insert with check (has_role(org_id, array['admin', 'direction', 'agent']));
drop policy if exists reservations_update on public.reservations;
create policy reservations_update on public.reservations for update
  using (has_role(org_id, array['admin', 'direction', 'agent'])) with check (has_role(org_id, array['admin', 'direction', 'agent']));
drop policy if exists reservations_delete on public.reservations;
create policy reservations_delete on public.reservations for delete using (has_role(org_id, array['admin', 'direction']));

drop policy if exists clients_write on public.clients;
drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients for insert with check (has_role(org_id, array['admin', 'direction', 'agent']));
drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients for update
  using (has_role(org_id, array['admin', 'direction', 'agent'])) with check (has_role(org_id, array['admin', 'direction', 'agent']));
drop policy if exists clients_delete on public.clients;
create policy clients_delete on public.clients for delete using (has_role(org_id, array['admin', 'direction']));

drop policy if exists vehicles_write on public.vehicles;
drop policy if exists vehicles_insert on public.vehicles;
create policy vehicles_insert on public.vehicles for insert with check (has_role(org_id, array['admin', 'direction', 'agent', 'mecanicien']));
drop policy if exists vehicles_update on public.vehicles;
create policy vehicles_update on public.vehicles for update
  using (has_role(org_id, array['admin', 'direction', 'agent', 'mecanicien'])) with check (has_role(org_id, array['admin', 'direction', 'agent', 'mecanicien']));
drop policy if exists vehicles_delete on public.vehicles;
create policy vehicles_delete on public.vehicles for delete using (has_role(org_id, array['admin', 'direction']));

create or replace function public.create_organization(p_name text, p_country text default 'SN')
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid; v_email text;
begin
  if auth.uid() is null then raise exception 'non authentifié'; end if;
  if length(trim(coalesce(p_name, ''))) not between 2 and 120 then
    raise exception 'Indiquez le nom de l''entreprise (2 à 120 caractères).' using errcode = 'P0001';
  end if;
  if (select count(*) from memberships where user_id = auth.uid() and role = 'admin') >= 3 then
    raise exception 'Vous administrez déjà 3 entreprises. Contactez Yoon Fleet pour en ajouter.' using errcode = 'P0001';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into organizations (name, country) values (trim(p_name), coalesce(p_country, 'SN'))
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
