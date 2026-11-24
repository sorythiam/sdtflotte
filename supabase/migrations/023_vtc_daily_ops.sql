-- Yoon Fleet — module VTC, lot 1 : pénalités de retard, jours non dus, avances et remises,
-- caisse des encaisseurs (espèces à remettre au propriétaire).

alter table public.vtc_contracts
  add column if not exists late_fee int not null default 0 check (late_fee between 0 and 100000),
  add column if not exists grace_days int not null default 2 check (grace_days between 0 and 30);

alter table public.vtc_payments
  add column if not exists collected_by text check (collected_by is null or length(collected_by) <= 160),
  add column if not exists handed_at timestamptz,
  add column if not exists handed_by text check (handed_by is null or length(handed_by) <= 160);
-- Les espèces déjà enregistrées sont considérées comme remises.
update public.vtc_payments set handed_at = created_at where method = 'especes' and handed_at is null;

create table if not exists public.vtc_adjustments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  contract_id uuid not null references public.vtc_contracts (id) on delete cascade,
  kind text not null check (kind in ('jour_offert', 'avance', 'remise', 'retenue_caution')),
  day date not null,
  amount int not null default 0 check (amount >= 0 and amount <= 100000000),
  note text check (note is null or length(note) <= 300),
  created_by text check (created_by is null or length(created_by) <= 160),
  created_at timestamptz not null default now(),
  check (kind = 'jour_offert' or amount > 0)
);
create index if not exists vtc_adjustments_contract on public.vtc_adjustments (contract_id);
create unique index if not exists vtc_adjustments_day_off on public.vtc_adjustments (contract_id, day) where kind = 'jour_offert';

create or replace function public.check_vtc_adjustment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from vtc_contracts where id = new.contract_id and org_id = new.org_id) then
    raise exception 'Contrat VTC inconnu' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.check_vtc_adjustment() from public, anon, authenticated;
drop trigger if exists vtc_adjustments_links on public.vtc_adjustments;
create trigger vtc_adjustments_links before insert or update on public.vtc_adjustments for each row execute function check_vtc_adjustment();

alter table public.vtc_adjustments enable row level security;
drop policy if exists vtc_adj_read on public.vtc_adjustments;
create policy vtc_adj_read on public.vtc_adjustments for select using (has_role(org_id, array['admin', 'direction', 'agent', 'comptable']));
-- Agents : jours non dus et avances ; remises et retenues sur caution : direction seulement.
drop policy if exists vtc_adj_insert on public.vtc_adjustments;
create policy vtc_adj_insert on public.vtc_adjustments for insert with check (
  has_role(org_id, array['admin', 'direction'])
  or (kind in ('jour_offert', 'avance') and has_role(org_id, array['agent']))
);
drop policy if exists vtc_adj_delete on public.vtc_adjustments;
create policy vtc_adj_delete on public.vtc_adjustments for delete using (has_role(org_id, array['admin', 'direction']));

drop trigger if exists vtc_adjustments_audit on public.vtc_adjustments;
create trigger vtc_adjustments_audit after insert or update or delete on public.vtc_adjustments for each row execute function write_audit();

/** La direction confirme avoir récupéré les espèces : seuls ces champs changent, jamais le montant. */
create or replace function public.vtc_hand_over(p_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update vtc_payments p set handed_at = now(), handed_by = coalesce(auth.jwt() ->> 'email', 'direction')
  where p.id = any(p_ids) and p.handed_at is null and p.method = 'especes'
    and has_role(p.org_id, array['admin', 'direction']);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.vtc_hand_over(uuid[]) from public, anon;
grant execute on function public.vtc_hand_over(uuid[]) to authenticated;
