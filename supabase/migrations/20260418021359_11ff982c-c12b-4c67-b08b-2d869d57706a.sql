ALTER TABLE public.team_subscriptions
  ADD COLUMN IF NOT EXISTS court_minutes_per_quarter integer,
  ADD COLUMN IF NOT EXISTS court_rotation_mode text,
  ADD COLUMN IF NOT EXISTS court_rotation_interval_minutes integer,
  ADD COLUMN IF NOT EXISTS court_validation_mode text,
  ADD COLUMN IF NOT EXISTS court_period_type text,
  ADD COLUMN IF NOT EXISTS court_timeouts_per_half integer;