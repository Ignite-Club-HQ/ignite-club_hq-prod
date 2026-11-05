SELECT cron.unschedule('notify-game-kickoff') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='notify-game-kickoff');

SELECT cron.schedule(
  'notify-game-kickoff',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/notify-game-kickoff',
    headers := ('{"Content-Type":"application/json","x-cron-secret":"' || coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SECRET' LIMIT 1), '') || '"}')::jsonb,
    body := '{}'::jsonb
  );
  $$
);