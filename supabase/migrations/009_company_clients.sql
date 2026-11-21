-- Yoon Fleet — fiche client entreprise : adresse, identifiants légaux, personne de contact.
alter table public.clients
  add column if not exists address text check (address is null or length(address) <= 200),
  add column if not exists city text check (city is null or length(city) <= 80),
  add column if not exists tax_id text check (tax_id is null or length(tax_id) <= 40),
  add column if not exists trade_register text check (trade_register is null or length(trade_register) <= 60),
  add column if not exists contact_name text check (contact_name is null or length(contact_name) <= 120),
  add column if not exists contact_role text check (contact_role is null or length(contact_role) <= 80),
  add column if not exists contact_phone text check (contact_phone is null or length(contact_phone) <= 30),
  add column if not exists contact_email text check (contact_email is null or length(contact_email) <= 160);
