-- Hand-written. Schedules the outbox drain on Supabase Cron (pg_cron + pg_net)
-- every minute. Skips itself on plain Postgres (local tests, CI), where those
-- extensions and the Vault do not exist.
--
-- The URL and the secret are NOT in this file. They are read from Supabase
-- Vault at run time, under the names `gusto_cron_url` (the full URL of
-- /api/cron/notifications) and `gusto_cron_secret` (the same value as the
-- app's CRON_SECRET). See README, "Notification delivery".
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net')
     OR NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'supabase_vault') THEN
    RAISE NOTICE 'pg_cron / pg_net / supabase_vault not available: notification cron not scheduled';
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;
  CREATE EXTENSION IF NOT EXISTS supabase_vault;

  -- Idempotent: replace an existing schedule of the same name.
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'gusto-notifications';

  PERFORM cron.schedule(
    'gusto-notifications',
    '* * * * *',
    $job$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'gusto_cron_url'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'gusto_cron_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 10000
      );
    $job$
  );
END
$migration$;
