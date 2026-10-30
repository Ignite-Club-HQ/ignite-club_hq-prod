-- Create app_settings table for global app configuration
CREATE TABLE IF NOT EXISTS public.app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value jsonb NOT NULL DEFAULT '{}',
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read settings
CREATE POLICY "Authenticated users can read app settings"
ON public.app_settings FOR SELECT
TO authenticated
USING (true);

-- Only app admins can modify settings
CREATE POLICY "App admins can manage app settings"
ON public.app_settings FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'app_admin', NULL, NULL))
WITH CHECK (public.has_role(auth.uid(), 'app_admin', NULL, NULL));

-- Add updated_at trigger
CREATE TRIGGER update_app_settings_updated_at
BEFORE UPDATE ON public.app_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert the club creation lock setting (locked by default for pilot)
INSERT INTO public.app_settings (key, value, description)
VALUES ('club_creation_locked', 'true', 'When true, only app admins can create new clubs');