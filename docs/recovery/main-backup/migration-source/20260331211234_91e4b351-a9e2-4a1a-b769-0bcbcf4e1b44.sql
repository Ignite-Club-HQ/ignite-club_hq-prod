ALTER TABLE public.fcm_tokens ADD COLUMN IF NOT EXISTS app_version TEXT;
ALTER TABLE public.fcm_tokens ADD COLUMN IF NOT EXISTS build_number TEXT;