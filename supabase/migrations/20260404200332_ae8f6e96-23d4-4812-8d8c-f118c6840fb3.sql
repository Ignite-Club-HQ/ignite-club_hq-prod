
SELECT cron.schedule(
  'send-engagement-reminders-daily',
  '0 10 * * *',
  $$
  SELECT net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/send-engagement-reminders',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "' || coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1), '') || '"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
