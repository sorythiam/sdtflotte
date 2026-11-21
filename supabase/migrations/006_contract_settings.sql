-- Yoon Fleet — réglages du contrat de location : coordonnées, logo, conditions générales.
-- Modifiables par l'administrateur (règle org_update existante). Taille bornée : le logo
-- est réduit dans le navigateur avant l'envoi.
alter table public.organizations add column if not exists contract jsonb;
alter table public.organizations drop constraint if exists organizations_contract_size;
alter table public.organizations add constraint organizations_contract_size
  check (contract is null or (jsonb_typeof(contract) = 'object' and octet_length(contract::text) < 400000));
