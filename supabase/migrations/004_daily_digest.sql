-- Yoon Fleet — récapitulatif quotidien des alertes par email.
-- Chaque membre choisit s'il le reçoit (par défaut : admin, direction, agent).
-- Un journal des envois empêche d'envoyer deux fois le même jour.

alter table public.memberships add column if not exists daily_digest boolean;

create or replace function public.set_daily_digest(p_org uuid, p_on boolean)
returns void language sql security definer set search_path = public as $$
  update memberships set daily_digest = p_on where org_id = p_org and user_id = auth.uid();
$$;
revoke execute on function public.set_daily_digest(uuid, boolean) from public, anon;
grant execute on function public.set_daily_digest(uuid, boolean) to authenticated;

create table if not exists public.digest_log (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  sent_on date not null,
  alerts int not null,
  provider_id text,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id, sent_on)
);
-- Réservé au serveur : aucune règle d'accès pour les utilisateurs.
alter table public.digest_log enable row level security;

-- Secret partagé entre la tâche planifiée et la fonction d'envoi, rangé dans le coffre Supabase.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'daily_digest_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'daily_digest_secret', 'Appel de la fonction daily-digest');
  end if;
end $$;

create or replace function public.daily_digest_secret_ok(p text)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'daily_digest_secret' and decrypted_secret = p);
$$;
revoke execute on function public.daily_digest_secret_ok(text) from public, anon, authenticated;
grant execute on function public.daily_digest_secret_ok(text) to service_role;
