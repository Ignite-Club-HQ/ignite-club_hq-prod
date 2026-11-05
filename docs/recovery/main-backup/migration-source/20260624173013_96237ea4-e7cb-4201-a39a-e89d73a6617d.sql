-- 1) Flip the club-level default for AI Catch Me Up to OFF, and disable it for all existing clubs
ALTER TABLE public.clubs ALTER COLUMN ai_catch_up_enabled SET DEFAULT false;
UPDATE public.clubs SET ai_catch_up_enabled = false WHERE ai_catch_up_enabled IS DISTINCT FROM false;

-- 2) Add a per-user toggle (default ON — club gate still applies)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ai_catch_up_enabled boolean NOT NULL DEFAULT true;