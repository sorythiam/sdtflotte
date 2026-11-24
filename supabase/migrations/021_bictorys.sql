-- Yoon Fleet — Bictorys comme prestataire de paiement de l'abonnement (à côté de PayDunya).
alter table public.subscription_payments drop constraint if exists subscription_payments_provider_check;
alter table public.subscription_payments add constraint subscription_payments_provider_check
  check (provider in ('bictorys', 'paydunya', 'simulation', 'manuel'));
