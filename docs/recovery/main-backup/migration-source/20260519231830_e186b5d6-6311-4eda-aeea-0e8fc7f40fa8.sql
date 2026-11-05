-- Auto RSVP push cadence (Pro): T-6d / T-48h / T-6h.
-- Offsets are chosen so they never collide with the auto-DM cadence
-- (T-72h / T-24h / T-3h); minimum gap is 21h.

-- 1) Per-team toggle + cadence allowlist (defaults OFF so existing teams opt-in).
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS auto_rsvp_push_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_rsvp_push_cadences text[] NOT NULL DEFAULT ARRAY['t6d','t48h','t6h']::text[],
  ADD COLUMN IF NOT EXISTS auto_rsvp_push_event_types text[] NOT NULL DEFAULT ARRAY['match','training','game']::text[];

-- 2) Dedupe log so cron drift / re-runs can't double-send.
CREATE TABLE IF NOT EXISTS public.event_auto_push_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  cadence text NOT NULL CHECK (cadence IN ('t6d','t48h','t6h')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  notification_id uuid,
  UNIQUE (event_id, user_id, cadence)
);

CREATE INDEX IF NOT EXISTS event_auto_push_log_event_idx
  ON public.event_auto_push_log(event_id);
CREATE INDEX IF NOT EXISTS event_auto_push_log_user_idx
  ON public.event_auto_push_log(user_id);

ALTER TABLE public.event_auto_push_log ENABLE ROW LEVEL SECURITY;

-- Only service role writes/reads this; no end-user policies needed.
-- Add a restrictive default policy so no anon access is possible.
DROP POLICY IF EXISTS "auto_push_log_no_client_access" ON public.event_auto_push_log;
CREATE POLICY "auto_push_log_no_client_access"
  ON public.event_auto_push_log
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);
