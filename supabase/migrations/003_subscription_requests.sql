-- Yoon Fleet — demandes de passage à la version payante.
-- En attendant le paiement en ligne, l'administrateur envoie une demande ;
-- l'équipe Yoon Fleet la traite (paiement, puis formule et quota mis à jour).

create table if not exists public.subscription_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  plan text not null check (plan in ('essentiel', 'pro', 'entreprise')),
  vehicles int not null check (vehicles between 1 and 10000),
  billing text not null check (billing in ('annuel', 'mensuel')),
  amount int not null check (amount >= 0), -- montant affiché au client, FCFA HT
  contact_phone text,
  status text not null default 'nouvelle' check (status in ('nouvelle', 'en_cours', 'payee', 'annulee')),
  requested_by uuid references auth.users (id) on delete set null,
  requested_email text,
  created_at timestamptz not null default now()
);
create index if not exists subscription_requests_org on public.subscription_requests (org_id, created_at desc);

alter table public.subscription_requests enable row level security;
drop policy if exists subreq_read on public.subscription_requests;
create policy subreq_read on public.subscription_requests for select using (has_role(org_id, array['admin']));
drop policy if exists subreq_insert on public.subscription_requests;
create policy subreq_insert on public.subscription_requests for insert with check (has_role(org_id, array['admin']));
-- Pas de mise à jour ni de suppression côté client : le statut est géré par Yoon Fleet.

create or replace function public.stamp_subscription_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.requested_by := auth.uid();
  new.requested_email := (select lower(email) from auth.users where id = auth.uid());
  new.status := 'nouvelle';
  return new;
end $$;
drop trigger if exists subreq_stamp on public.subscription_requests;
create trigger subreq_stamp before insert on public.subscription_requests
  for each row execute function stamp_subscription_request();
revoke execute on function public.stamp_subscription_request() from public, anon, authenticated;
