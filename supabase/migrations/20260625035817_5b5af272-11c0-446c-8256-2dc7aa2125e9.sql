
-- AI Catch Me Up: TTL + disclosure tracking
ALTER TABLE public.chat_summaries
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '48 hours');

CREATE INDEX IF NOT EXISTS chat_summaries_expires_at_idx ON public.chat_summaries (expires_at);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ai_catch_up_acknowledged_at timestamptz;

-- RPC for the client to record disclosure acknowledgement for the current user
CREATE OR REPLACE FUNCTION public.acknowledge_ai_catch_up_disclosure()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  UPDATE public.profiles
    SET ai_catch_up_acknowledged_at = v_now
    WHERE id = auth.uid();
  RETURN v_now;
END;
$$;

GRANT EXECUTE ON FUNCTION public.acknowledge_ai_catch_up_disclosure() TO authenticated;

-- Cleanup expired summaries
CREATE OR REPLACE FUNCTION public.cleanup_expired_chat_summaries()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  WITH d AS (
    DELETE FROM public.chat_summaries WHERE expires_at < now() RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM d;
  RETURN v_deleted;
END;
$$;

-- Backfill expires_at on existing rows (48h from now to give them a fair window)
UPDATE public.chat_summaries SET expires_at = now() + interval '48 hours' WHERE expires_at IS NULL OR expires_at < now();
