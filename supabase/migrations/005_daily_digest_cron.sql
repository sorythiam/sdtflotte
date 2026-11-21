-- Yoon Fleet — planification du récapitulatif : tous les jours à 7 h UTC
-- (7 h à Dakar et Abidjan, 8 h à Douala et Cotonou).
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'yoonfleet-daily-digest') then
    perform cron.unschedule('yoonfleet-daily-digest');
  end if;
end $$;

select cron.schedule(
  'yoonfleet-daily-digest',
  '0 7 * * *',
  $cron$
  select net.http_post(
    url := 'https://rayoutbyoswqskclofyw.supabase.co/functions/v1/daily-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'daily_digest_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);
