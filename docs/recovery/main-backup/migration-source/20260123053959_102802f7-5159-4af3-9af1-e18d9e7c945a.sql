-- Create admin_alerts table to track sent alerts and prevent duplicates
CREATE TABLE IF NOT EXISTS public.admin_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_type TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.admin_alerts ENABLE ROW LEVEL SECURITY;

-- Only app admins can view alerts
CREATE POLICY "App admins can view admin alerts"
  ON public.admin_alerts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'app_admin'
    )
  );

-- Create index for efficient lookups
CREATE INDEX idx_admin_alerts_type_created ON public.admin_alerts(alert_type, created_at DESC);

-- Schedule the failure rate check to run every 4 hours
SELECT cron.schedule(
  'check-push-failure-rate-every-4h',
  '0 */4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/check-push-failure-rate',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);