-- Enable required extensions for cron jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule daily renewal reminder job at 8:00 AM UTC
SELECT cron.schedule(
  'send-renewal-reminders-daily',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/send-renewal-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.settings.cron_secret', true)
    ),
    body := jsonb_build_object('triggered_at', now()::text)
  ) AS request_id;
  $$
);