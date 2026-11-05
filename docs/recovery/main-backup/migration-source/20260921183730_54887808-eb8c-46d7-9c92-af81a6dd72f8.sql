ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS invite_email_message text;
ALTER TABLE public.competitions ADD COLUMN IF NOT EXISTS invite_email_message text;