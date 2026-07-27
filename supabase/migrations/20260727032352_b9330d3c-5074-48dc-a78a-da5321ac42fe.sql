-- 1. Durable Stripe webhook event ledger
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  stripe_event_id text PRIMARY KEY,
  event_type text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  attempts integer NOT NULL DEFAULT 0,
  stripe_object_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT stripe_webhook_events_status_chk
    CHECK (status IN ('processing', 'completed', 'failed'))
);

-- No client-side access whatsoever.
REVOKE ALL ON public.stripe_webhook_events FROM PUBLIC;
REVOKE ALL ON public.stripe_webhook_events FROM anon;
REVOKE ALL ON public.stripe_webhook_events FROM authenticated;
GRANT ALL ON public.stripe_webhook_events TO service_role;

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: only service_role (which bypasses RLS) may access.

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_status_updated
  ON public.stripe_webhook_events (status, updated_at DESC);

-- 2. Out-of-order protection columns
ALTER TABLE public.club_subscriptions
  ADD COLUMN IF NOT EXISTS last_stripe_event_id text,
  ADD COLUMN IF NOT EXISTS last_stripe_event_at timestamptz;

ALTER TABLE public.team_subscriptions
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS last_stripe_event_id text,
  ADD COLUMN IF NOT EXISTS last_stripe_event_at timestamptz;

-- 3. Atomic event claim
CREATE OR REPLACE FUNCTION public.claim_stripe_webhook_event(
  p_event_id text,
  p_event_type text,
  p_object_id text DEFAULT NULL,
  p_stale_after interval DEFAULT interval '15 minutes'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.stripe_webhook_events%ROWTYPE;
BEGIN
  IF p_event_id IS NULL OR length(trim(p_event_id)) = 0 THEN
    RAISE EXCEPTION 'stripe event id required';
  END IF;

  INSERT INTO public.stripe_webhook_events (stripe_event_id, event_type, status, attempts, stripe_object_id)
  VALUES (p_event_id, coalesce(p_event_type, 'unknown'), 'processing', 1, p_object_id)
  ON CONFLICT (stripe_event_id) DO NOTHING;

  IF FOUND THEN
    RETURN 'claimed';
  END IF;

  SELECT * INTO v_row
  FROM public.stripe_webhook_events
  WHERE stripe_event_id = p_event_id
  FOR UPDATE;

  IF v_row.status = 'completed' THEN
    RETURN 'duplicate_completed';
  END IF;

  IF v_row.status = 'processing' AND v_row.updated_at > now() - p_stale_after THEN
    RETURN 'in_progress';
  END IF;

  -- failed, or a stale processing claim: allow a safe retry
  UPDATE public.stripe_webhook_events
  SET status = 'processing',
      attempts = v_row.attempts + 1,
      updated_at = now(),
      stripe_object_id = coalesce(p_object_id, v_row.stripe_object_id)
  WHERE stripe_event_id = p_event_id;

  RETURN 'claimed';
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_stripe_webhook_event(p_event_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.stripe_webhook_events
  SET status = 'completed',
      completed_at = now(),
      updated_at = now(),
      last_error = NULL
  WHERE stripe_event_id = p_event_id;
$$;

CREATE OR REPLACE FUNCTION public.fail_stripe_webhook_event(p_event_id text, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.stripe_webhook_events
  SET status = 'failed',
      updated_at = now(),
      last_error = left(coalesce(p_error, 'unspecified error'), 300)
  WHERE stripe_event_id = p_event_id;
$$;

-- 4. Atomic storage add-on application (claim completion + increment + notify)
CREATE OR REPLACE FUNCTION public.apply_stripe_storage_addon(
  p_event_id text,
  p_club_id uuid,
  p_storage_gb integer,
  p_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_club_name text;
BEGIN
  IF p_event_id IS NULL OR p_club_id IS NULL OR p_storage_gb IS NULL OR p_storage_gb <= 0 THEN
    RAISE EXCEPTION 'invalid storage add-on arguments';
  END IF;

  SELECT status INTO v_status
  FROM public.stripe_webhook_events
  WHERE stripe_event_id = p_event_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'stripe event not claimed';
  END IF;

  IF v_status = 'completed' THEN
    RETURN 'already_applied';
  END IF;

  UPDATE public.club_subscriptions
  SET storage_purchased_gb = coalesce(storage_purchased_gb, 0) + p_storage_gb
  WHERE club_id = p_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no club_subscriptions row for club';
  END IF;

  SELECT name INTO v_club_name FROM public.clubs WHERE id = p_club_id;

  IF p_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, message, related_id)
    VALUES (
      p_user_id,
      'storage_purchased',
      'Your ' || p_storage_gb || 'GB storage addon for ' || coalesce(v_club_name, 'your club') || ' has been activated!',
      p_club_id
    );
  END IF;

  UPDATE public.stripe_webhook_events
  SET status = 'completed', completed_at = now(), updated_at = now(), last_error = NULL
  WHERE stripe_event_id = p_event_id;

  RETURN 'applied';
END;
$$;

-- 5. Out-of-order guard helper
CREATE OR REPLACE FUNCTION public.stripe_event_is_stale(
  p_subscription_id text,
  p_event_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_subscriptions
    WHERE stripe_subscription_id = p_subscription_id
      AND last_stripe_event_at IS NOT NULL
      AND p_event_at IS NOT NULL
      AND last_stripe_event_at > p_event_at
    UNION ALL
    SELECT 1 FROM public.team_subscriptions
    WHERE stripe_subscription_id = p_subscription_id
      AND last_stripe_event_at IS NOT NULL
      AND p_event_at IS NOT NULL
      AND last_stripe_event_at > p_event_at
  );
$$;

-- 6. Lock down every new function to service_role only
REVOKE ALL ON FUNCTION public.claim_stripe_webhook_event(text, text, text, interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_stripe_webhook_event(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_stripe_webhook_event(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_stripe_storage_addon(text, uuid, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stripe_event_is_stale(text, timestamptz) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_stripe_webhook_event(text, text, text, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_stripe_webhook_event(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_stripe_webhook_event(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_stripe_storage_addon(text, uuid, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.stripe_event_is_stale(text, timestamptz) TO service_role;