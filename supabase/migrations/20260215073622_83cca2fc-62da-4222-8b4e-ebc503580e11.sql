-- Change retry-missed-push-notifications cron from every 2 minutes to every 1 minute
-- The pg_net trigger is consistently failing, so this reduces worst-case delay from 2min to 1min
SELECT cron.unschedule(6);

SELECT cron.schedule(
  'retry-missed-push-notifications',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/retry-missed-push-notifications',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);