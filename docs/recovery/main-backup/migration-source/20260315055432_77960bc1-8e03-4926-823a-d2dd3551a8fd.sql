
SELECT cron.schedule(
  'auto-purge-trash-daily',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/auto-purge-trash',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1), '')
    ),
    body := '{"triggered_at": "now"}'::jsonb
  ) AS request_id;
  $$
);
