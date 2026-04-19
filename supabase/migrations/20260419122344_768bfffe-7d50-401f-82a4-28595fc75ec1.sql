-- Schedule the process-scheduled-messages worker to run every minute.
-- Unschedules first to avoid duplicates if re-run.
DO $$
BEGIN
  PERFORM cron.unschedule('process-scheduled-messages-every-minute');
EXCEPTION WHEN OTHERS THEN
  -- Job didn't exist yet; ignore.
  NULL;
END $$;

SELECT cron.schedule(
  'process-scheduled-messages-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/process-scheduled-messages',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as"}'::jsonb,
    body := jsonb_build_object('time', now())
  );
  $$
);