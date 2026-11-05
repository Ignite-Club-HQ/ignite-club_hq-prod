SELECT cron.schedule(
  'cleanup-old-notifications-daily',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url:='https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/cleanup-old-notifications',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as"}'::jsonb,
    body:='{"triggered_by": "cron"}'::jsonb
  ) AS request_id;
  $$
);