ALTER TABLE public.team_subscriptions
  ADD COLUMN IF NOT EXISTS pitch_notify_coach boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pitch_notify_team_admin boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pitch_notify_subs_manager boolean NOT NULL DEFAULT true;