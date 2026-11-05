-- Create table for push alert settings
CREATE TABLE IF NOT EXISTS public.push_alert_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  failure_threshold_percent INTEGER NOT NULL DEFAULT 20,
  check_window_hours INTEGER NOT NULL DEFAULT 24,
  min_notifications INTEGER NOT NULL DEFAULT 10,
  cooldown_hours INTEGER NOT NULL DEFAULT 6,
  alerts_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.push_alert_settings ENABLE ROW LEVEL SECURITY;

-- App admins can view settings
CREATE POLICY "App admins can view push alert settings"
  ON public.push_alert_settings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'app_admin'
    )
  );

-- App admins can update settings
CREATE POLICY "App admins can update push alert settings"
  ON public.push_alert_settings
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'app_admin'
    )
  );

-- Insert default settings row
INSERT INTO public.push_alert_settings (
  failure_threshold_percent,
  check_window_hours,
  min_notifications,
  cooldown_hours,
  alerts_enabled
) VALUES (20, 24, 10, 6, true);