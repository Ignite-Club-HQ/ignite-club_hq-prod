
-- AdMob configuration table (one row per platform)
CREATE TABLE public.admob_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  app_id TEXT NOT NULL DEFAULT '',
  banner_ad_unit_id TEXT NOT NULL DEFAULT '',
  interstitial_ad_unit_id TEXT NOT NULL DEFAULT '',
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(platform)
);

-- Enable RLS
ALTER TABLE public.admob_config ENABLE ROW LEVEL SECURITY;

-- Anyone can read (needed by the app to init AdMob)
CREATE POLICY "Anyone can read admob config"
ON public.admob_config FOR SELECT
USING (true);

-- Only app_admin can modify
CREATE POLICY "App admins can insert admob config"
ON public.admob_config FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'app_admin'
  )
);

CREATE POLICY "App admins can update admob config"
ON public.admob_config FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'app_admin'
  )
);

-- Seed both platforms
INSERT INTO public.admob_config (platform) VALUES ('android'), ('ios');

-- Timestamp trigger
CREATE TRIGGER update_admob_config_updated_at
BEFORE UPDATE ON public.admob_config
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
