-- Remove the incorrectly configured job
SELECT cron.unschedule('send-renewal-reminders-daily');

-- Re-schedule with the secret passed via vault
-- First, store the cron secret reference
DO $$
BEGIN
  PERFORM set_config('app.settings.cron_secret', 
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1), 
    false);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Vault secret not found, using header approach';
END $$;

-- Schedule daily renewal reminder job at 8:00 AM UTC using direct header
SELECT cron.schedule(
  'send-renewal-reminders-daily',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/send-renewal-reminders',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "' || coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1), '') || '"}'::jsonb,
    body := '{"triggered_at": "now"}'::jsonb
  ) AS request_id;
  $$
);