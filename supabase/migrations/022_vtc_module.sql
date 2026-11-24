-- Yoon Fleet — module Chauffeurs VTC payant, en plus de l'abonnement (25 000 FCFA HT par mois).

alter table public.organizations add column if not exists vtc_until timestamptz;

create or replace function public.protect_billing_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' and (
    new.plan is distinct from old.plan or
    new.vehicle_quota is distinct from old.vehicle_quota or
    new.trial_ends_at is distinct from old.trial_ends_at or
    new.paid_until is distinct from old.paid_until or
    new.billing_cycle is distinct from old.billing_cycle or
    new.vtc_until is distinct from old.vtc_until
  ) then
    raise exception 'formule et quota modifiables par Yoon Fleet uniquement';
  end if;
  return new;
end $$;

alter table public.subscription_payments
  add column if not exists item text not null default 'abonnement' check (item in ('abonnement', 'vtc'));

create or replace function public.activate_subscription(p_id uuid, p_raw jsonb default null)
returns public.subscription_payments
language plpgsql security definer set search_path = public as $$
declare
  p subscription_payments;
  o organizations;
  y int := extract(year from now() at time zone 'Africa/Dakar');
  n int;
  s timestamptz := now();
  e timestamptz;
  step interval;
begin
  select * into p from subscription_payments where id = p_id for update;
  if not found then raise exception 'Paiement inconnu'; end if;
  if p.status = 'payee' then return p; end if;
  select * into o from organizations where id = p.org_id for update;
  step := case when p.billing = 'annuel' then interval '1 year' else interval '1 month' end;
  -- Module VTC : la période s'ajoute à celle en cours. Abonnement : elle part du paiement (le reste a été déduit).
  if p.item = 'vtc' and o.vtc_until is not null and o.vtc_until > s then s := o.vtc_until; end if;
  e := s + step;
  insert into saas_invoice_counters (year, last) values (y, 1)
    on conflict (year) do update set last = saas_invoice_counters.last + 1
    returning last into n;
  update subscription_payments set
    status = 'payee', paid_at = now(), period_start = s, period_end = e,
    invoice_number = 'YF-' || y || '-' || lpad(n::text, 4, '0'),
    raw = coalesce(p_raw, raw)
  where id = p_id returning * into p;
  if p.item = 'vtc' then
    update organizations set vtc_until = e where id = p.org_id;
  else
    update organizations set
      plan = p.plan, vehicle_quota = p.vehicles, paid_until = e, billing_cycle = p.billing, trial_ends_at = null
    where id = p.org_id;
  end if;
  return p;
end $$;
revoke execute on function public.activate_subscription(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.activate_subscription(uuid, jsonb) to service_role;
