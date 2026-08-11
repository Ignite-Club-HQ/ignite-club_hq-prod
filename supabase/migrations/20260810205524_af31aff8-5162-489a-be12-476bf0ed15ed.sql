ALTER TABLE public.clubs
  ADD COLUMN IF NOT EXISTS invite_email_style text NOT NULL DEFAULT 'detailed';

ALTER TABLE public.clubs
  DROP CONSTRAINT IF EXISTS clubs_invite_email_style_check;

ALTER TABLE public.clubs
  ADD CONSTRAINT clubs_invite_email_style_check
  CHECK (invite_email_style IN ('detailed', 'simple'));