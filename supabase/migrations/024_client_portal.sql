-- Yoon Fleet — espace client d'une réservation : dossier, photos des pièces, signature des
-- conditions et acompte déclaré (payé au loueur par son code marchand Wave / Orange Money).
-- Yoon Fleet n'encaisse rien : le loueur confirme lui-même la réception de l'acompte.

-- ---------------------------------------------------------------- lien unique par réservation
create table if not exists public.reservation_portals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  reservation_id uuid not null unique references public.reservations (id) on delete cascade,
  -- 256 bits aléatoires : le lien est le seul secret.
  token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
    check (token ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  created_by text check (created_by is null or length(created_by) <= 160),
  opened_at timestamptz,
  submitted_at timestamptz,
  signer_name text check (signer_name is null or length(signer_name) <= 120),
  signature text check (signature is null or (length(signature) <= 300000 and signature like 'data:image/png;base64,%')),
  signed_at timestamptz
);

create or replace function public.check_portal_links()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from reservations where id = new.reservation_id and org_id = new.org_id) then
    raise exception 'Réservation inconnue' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.jwt() ->> 'email', new.created_by);
    new.opened_at := null; new.submitted_at := null; new.signer_name := null; new.signature := null; new.signed_at := null;
  end if;
  return new;
end $$;
revoke execute on function public.check_portal_links() from public, anon, authenticated;
drop trigger if exists reservation_portals_links on public.reservation_portals;
create trigger reservation_portals_links before insert on public.reservation_portals for each row execute function check_portal_links();

alter table public.reservation_portals enable row level security;
drop policy if exists portals_read on public.reservation_portals;
create policy portals_read on public.reservation_portals for select using (has_role(org_id, array['admin', 'direction', 'agent', 'comptable']));
drop policy if exists portals_insert on public.reservation_portals;
create policy portals_insert on public.reservation_portals for insert with check (has_role(org_id, array['admin', 'direction', 'agent']));
-- Supprimer le lien le désactive (un nouveau peut être créé).
drop policy if exists portals_delete on public.reservation_portals;
create policy portals_delete on public.reservation_portals for delete using (has_role(org_id, array['admin', 'direction', 'agent']));
drop trigger if exists reservation_portals_audit on public.reservation_portals;
create trigger reservation_portals_audit after insert or delete on public.reservation_portals for each row execute function write_audit();

-- ---------------------------------------------------------------- acomptes déclarés par le client
create table if not exists public.deposit_declarations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  amount int not null check (amount > 0 and amount <= 100000000),
  method text not null check (method in ('wave', 'orange_money')),
  reference text not null check (length(reference) between 4 and 60),
  declared_at timestamptz not null default now(),
  status text not null default 'declare' check (status in ('declare', 'confirme', 'rejete')),
  reviewed_by text check (reviewed_by is null or length(reviewed_by) <= 160),
  reviewed_at timestamptz,
  payment_id uuid references public.payments (id) on delete set null
);
create index if not exists deposit_declarations_res on public.deposit_declarations (reservation_id);

-- Le loueur ne change que le statut (et le paiement créé) ; le montant et la référence restent ceux du client.
create or replace function public.guard_deposit_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.amount <> old.amount or new.method <> old.method or new.reference <> old.reference
     or new.reservation_id <> old.reservation_id or new.org_id <> old.org_id or new.declared_at <> old.declared_at then
    raise exception 'Seul le statut d’un acompte déclaré peut changer' using errcode = 'P0001';
  end if;
  if old.status <> 'declare' then raise exception 'Acompte déjà traité' using errcode = 'P0001'; end if;
  if new.payment_id is not null and not exists (select 1 from payments where id = new.payment_id and org_id = new.org_id and reservation_id = new.reservation_id) then
    raise exception 'Paiement inconnu' using errcode = 'P0001';
  end if;
  new.reviewed_by := coalesce(auth.jwt() ->> 'email', new.reviewed_by);
  new.reviewed_at := now();
  return new;
end $$;
revoke execute on function public.guard_deposit_review() from public, anon, authenticated;
drop trigger if exists deposit_declarations_guard on public.deposit_declarations;
create trigger deposit_declarations_guard before update on public.deposit_declarations for each row execute function guard_deposit_review();

alter table public.deposit_declarations enable row level security;
drop policy if exists decl_read on public.deposit_declarations;
create policy decl_read on public.deposit_declarations for select using (has_role(org_id, array['admin', 'direction', 'agent', 'comptable']));
drop policy if exists decl_update on public.deposit_declarations;
create policy decl_update on public.deposit_declarations for update using (has_role(org_id, array['admin', 'direction', 'agent', 'comptable']));
drop trigger if exists deposit_declarations_audit on public.deposit_declarations;
create trigger deposit_declarations_audit after insert or update or delete on public.deposit_declarations for each row execute function write_audit();

-- ---------------------------------------------------------------- accès du client par son lien
/** Réservation encore ouverte au client : à venir ou en cours, ou terminée depuis moins de 7 jours. */
create or replace function public.portal_row(p_token text)
returns table (portal_id uuid, org_id uuid, reservation_id uuid, client_id uuid, status text)
language sql stable security definer set search_path = public as $$
  select p.id, p.org_id, r.id, r.client_id, r.status
  from reservation_portals p join reservations r on r.id = p.reservation_id
  where p.token = p_token and p_token ~ '^[a-f0-9]{64}$'
    and r.status <> 'annulee' and r."end" > now() - interval '7 days';
$$;
revoke execute on function public.portal_row(text) from public, anon, authenticated;

create or replace function public.portal_info(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x record; out jsonb;
begin
  select * into x from portal_row(p_token);
  if not found then return null; end if;
  update reservation_portals set opened_at = now() where id = x.portal_id and opened_at is null;
  select jsonb_build_object(
    'org', jsonb_build_object(
      'name', coalesce(nullif(o.contract->>'legalName', ''), o.name), 'phone', coalesce(o.contract->>'phone', ''),
      'logo', o.contract->>'logo', 'terms', coalesce(o.contract->>'terms', ''), 'country', o.country,
      'wave', coalesce(o.billing->'payees'->>'wave', ''), 'orangeMoney', coalesce(o.billing->'payees'->>'orangeMoney', '')),
    'reservation', jsonb_build_object(
      'number', r.number, 'status', r.status, 'start', r.start, 'end', r."end", 'withDriver', r.with_driver,
      'vehicle', v.brand || ' ' || v.model, 'total', r.total, 'caution', r.caution,
      'depositDue', coalesce(
        (select sum(i.deposit_due) from invoices i where i.reservation_id = r.id and i.kind = 'facture'),
        round(r.total * least(100, greatest(0, coalesce(c.deposit_percent, (o.billing->>'depositPercent')::numeric, 50))) / 100.0)),
      'paid', coalesce((select sum(case when p.kind = 'remboursement' then -p.amount else p.amount end) from payments p
                        where p.reservation_id = r.id and p.status = 'paye' and p.kind in ('acompte', 'solde', 'frais', 'remboursement')), 0),
      'declared', coalesce((select jsonb_agg(jsonb_build_object('amount', d.amount, 'method', d.method, 'reference', d.reference,
                                   'declaredAt', d.declared_at, 'status', d.status) order by d.declared_at)
                            from deposit_declarations d where d.reservation_id = r.id), '[]'::jsonb)),
    'client', jsonb_build_object(
      'kind', c.kind, 'name', c.name, 'phone', c.phone, 'email', c.email, 'address', c.address, 'city', c.city,
      'idType', c.id_type, 'idNumber', c.id_number, 'idExpiry', c.id_expiry, 'birthDate', c.birth_date,
      'licenseNumber', c.license_number, 'licenseCategory', c.license_category, 'licenseExpiry', c.license_expiry,
      'docs', jsonb_build_object('idFront', c.documents ? 'idFront', 'idBack', c.documents ? 'idBack', 'license', c.documents ? 'license')),
    'portal', jsonb_build_object('submittedAt', pt.submitted_at, 'signedAt', pt.signed_at, 'signerName', pt.signer_name,
                                 'uploadPrefix', r.org_id::text || '/' || r.client_id::text || '/portal-' || pt.token))
  into out
  from reservations r
  join organizations o on o.id = r.org_id
  join vehicles v on v.id = r.vehicle_id
  join clients c on c.id = r.client_id
  join reservation_portals pt on pt.id = x.portal_id
  where r.id = x.reservation_id;
  return out;
end $$;

/** Le client complète son dossier et signe les conditions. Un dossier déjà vérifié repasse à vérifier si les pièces changent. */
create or replace function public.portal_submit(p_token text, p_client jsonb, p_signer text, p_signature text)
returns void language plpgsql security definer set search_path = public as $$
declare x record; c clients%rowtype; t text;
begin
  select * into x from portal_row(p_token);
  if not found then raise exception 'Lien expiré ou invalide' using errcode = 'P0001'; end if;
  if x.status <> 'reservee' then raise exception 'Le véhicule a déjà été remis : voyez l’agence' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_client) <> 'object' then raise exception 'Données invalides' using errcode = 'P0001'; end if;
  if length(coalesce(p_signer, '')) not between 2 and 120 then raise exception 'Nom du signataire invalide' using errcode = 'P0001'; end if;
  if p_signature is null or length(p_signature) > 300000 or p_signature not like 'data:image/png;base64,%' then
    raise exception 'Signature invalide' using errcode = 'P0001';
  end if;
  t := p_client->>'idType';
  if t is not null and t not in ('cni', 'passeport', 'carte_cedeao', 'carte_sejour', 'autre') then raise exception 'Type de pièce invalide' using errcode = 'P0001'; end if;
  select * into c from clients where id = x.client_id;
  update clients set
    name = case when c.kind = 'particulier' then left(coalesce(nullif(trim(p_client->>'name'), ''), name), 120) else name end,
    phone = case when c.kind = 'particulier' then left(coalesce(nullif(trim(p_client->>'phone'), ''), phone), 30) else phone end,
    email = case when c.kind = 'particulier' then left(coalesce(nullif(trim(p_client->>'email'), ''), email), 160) else email end,
    address = left(coalesce(nullif(trim(p_client->>'address'), ''), address), 200),
    city = left(coalesce(nullif(trim(p_client->>'city'), ''), city), 80),
    id_type = coalesce(t, id_type),
    id_number = left(coalesce(nullif(trim(p_client->>'idNumber'), ''), id_number), 40),
    id_expiry = coalesce(nullif(p_client->>'idExpiry', '')::date, id_expiry),
    birth_date = coalesce(nullif(p_client->>'birthDate', '')::date, birth_date),
    license_number = left(coalesce(nullif(trim(p_client->>'licenseNumber'), ''), license_number), 40),
    license_category = left(coalesce(nullif(trim(p_client->>'licenseCategory'), ''), license_category), 20),
    license_expiry = coalesce(nullif(p_client->>'licenseExpiry', '')::date, license_expiry)
  where id = x.client_id;
  update clients set verified_at = null, verified_by = null
  where id = x.client_id and verified_at is not null
    and (id_number is distinct from c.id_number or license_number is distinct from c.license_number
         or id_expiry is distinct from c.id_expiry or license_expiry is distinct from c.license_expiry);
  update reservation_portals set submitted_at = now(), signer_name = trim(p_signer), signature = p_signature, signed_at = now()
  where id = x.portal_id;
end $$;

/** Photo envoyée par le client : nom de fichier <org>/<client>/portal-<jeton>-<aléa>.jpg (vérifié ici et par l'espace de stockage). */
create or replace function public.portal_upload_ok(p_name text)
returns boolean language plpgsql stable security definer set search_path = public, storage as $$
declare parts text[]; x record; n int;
begin
  parts := string_to_array(p_name, '/');
  if array_length(parts, 1) <> 3 or parts[3] !~ '^portal-[a-f0-9]{64}-[a-z0-9-]{8,40}\.jpg$' then return false; end if;
  select * into x from portal_row(substr(parts[3], 8, 64));
  if not found or x.status <> 'reservee' or x.org_id::text <> parts[1] or x.client_id::text <> parts[2] then return false; end if;
  -- Pas plus de 15 photos par heure et par client.
  select count(*) into n from storage.objects o
  where o.bucket_id = 'client-documents' and o.name like parts[1] || '/' || parts[2] || '/portal-%' and o.created_at > now() - interval '1 hour';
  return n < 15;
end $$;
revoke execute on function public.portal_upload_ok(text) from public;
grant execute on function public.portal_upload_ok(text) to anon, authenticated;

drop policy if exists client_docs_portal_insert on storage.objects;
create policy client_docs_portal_insert on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'client-documents' and public.portal_upload_ok(name));

/** Rattache la photo envoyée au dossier du client. */
create or replace function public.portal_attach(p_token text, p_slot text, p_path text)
returns void language plpgsql security definer set search_path = public as $$
declare x record;
begin
  select * into x from portal_row(p_token);
  if not found or x.status <> 'reservee' then raise exception 'Lien expiré ou invalide' using errcode = 'P0001'; end if;
  if p_slot not in ('idFront', 'idBack', 'license') then raise exception 'Pièce inconnue' using errcode = 'P0001'; end if;
  if p_path not like x.org_id::text || '/' || x.client_id::text || '/portal-' || p_token || '-%'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'client-documents' and o.name = p_path) then
    raise exception 'Photo introuvable' using errcode = 'P0001';
  end if;
  update clients set documents = coalesce(documents, '{}'::jsonb) || jsonb_build_object(p_slot, p_path),
    verified_at = null, verified_by = null
  where id = x.client_id;
end $$;

/** Le client déclare avoir payé l'acompte au loueur. */
create or replace function public.portal_declare(p_token text, p_method text, p_reference text, p_amount int)
returns void language plpgsql security definer set search_path = public as $$
declare x record; total int;
begin
  select * into x from portal_row(p_token);
  if not found or x.status not in ('reservee', 'en_cours') then raise exception 'Lien expiré ou invalide' using errcode = 'P0001'; end if;
  if p_method not in ('wave', 'orange_money') then raise exception 'Moyen de paiement invalide' using errcode = 'P0001'; end if;
  if length(trim(coalesce(p_reference, ''))) not between 4 and 60 then raise exception 'Référence invalide' using errcode = 'P0001'; end if;
  select r.total into total from reservations r where r.id = x.reservation_id;
  if p_amount is null or p_amount <= 0 or p_amount > greatest(total, 1) * 2 then raise exception 'Montant invalide' using errcode = 'P0001'; end if;
  if (select count(*) from deposit_declarations where reservation_id = x.reservation_id and status = 'declare') >= 3 then
    raise exception 'Déjà trois paiements en attente de vérification : contactez l’agence' using errcode = 'P0001';
  end if;
  if exists (select 1 from deposit_declarations where reservation_id = x.reservation_id and lower(reference) = lower(trim(p_reference))) then
    raise exception 'Cette référence a déjà été déclarée' using errcode = 'P0001';
  end if;
  insert into deposit_declarations (org_id, reservation_id, amount, method, reference)
  values (x.org_id, x.reservation_id, p_amount, p_method, trim(p_reference));
end $$;

revoke execute on function public.portal_info(text) from public;
revoke execute on function public.portal_submit(text, jsonb, text, text) from public;
revoke execute on function public.portal_attach(text, text, text) from public;
revoke execute on function public.portal_declare(text, text, text, int) from public;
grant execute on function public.portal_info(text) to anon, authenticated;
grant execute on function public.portal_submit(text, jsonb, text, text) to anon, authenticated;
grant execute on function public.portal_attach(text, text, text) to anon, authenticated;
grant execute on function public.portal_declare(text, text, text, int) to anon, authenticated;
