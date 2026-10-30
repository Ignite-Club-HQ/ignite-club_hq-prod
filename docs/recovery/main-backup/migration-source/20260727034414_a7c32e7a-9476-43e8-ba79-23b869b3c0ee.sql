-- =====================================================================
-- Durable Stripe subscription ordering + transactional transitions
-- =====================================================================

-- 1. Durable ordering/watermark record, keyed by Stripe subscription id.
CREATE TABLE IF NOT EXISTS public.stripe_subscription_event_state (
  stripe_subscription_id text PRIMARY KEY,
  entity_type text,
  entity_id uuid,
  last_event_id text NOT NULL,
  last_event_type text NOT NULL,
  last_event_at timestamptz NOT NULL,
  subscription_state text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stripe_subscription_event_state_entity_chk
    CHECK (entity_type IS NULL OR entity_type IN ('club', 'team')),
  CONSTRAINT stripe_subscription_event_state_state_chk
    CHECK (subscription_state IS NULL OR subscription_state IN ('active', 'cancelled'))
);

REVOKE ALL ON public.stripe_subscription_event_state FROM PUBLIC;
REVOKE ALL ON public.stripe_subscription_event_state FROM anon;
REVOKE ALL ON public.stripe_subscription_event_state FROM authenticated;
GRANT ALL ON public.stripe_subscription_event_state TO service_role;
ALTER TABLE public.stripe_subscription_event_state ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: only service_role (which bypasses RLS) may access.

-- 2. Notification outbox — exactly one notification per (event, purpose).
CREATE TABLE IF NOT EXISTS public.stripe_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL,
  purpose text NOT NULL,
  user_id uuid,
  entity_type text,
  entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stripe_notification_outbox_unique UNIQUE (stripe_event_id, purpose)
);

REVOKE ALL ON public.stripe_notification_outbox FROM PUBLIC;
REVOKE ALL ON public.stripe_notification_outbox FROM anon;
REVOKE ALL ON public.stripe_notification_outbox FROM authenticated;
GRANT ALL ON public.stripe_notification_outbox TO service_role;
ALTER TABLE public.stripe_notification_outbox ENABLE ROW LEVEL SECURITY;

-- 3. Ordering guard now consults the durable state record first.
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
    SELECT 1 FROM public.stripe_subscription_event_state
    WHERE stripe_subscription_id = p_subscription_id
      AND p_event_at IS NOT NULL
      AND last_event_at > p_event_at
    UNION ALL
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

-- 4. One atomic RPC for every subscription state transition.
CREATE OR REPLACE FUNCTION public.apply_stripe_subscription_transition(
  p_event_id text,
  p_event_type text,
  p_event_at timestamptz,
  p_subscription_id text,
  p_transition text,
  p_entity_type text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_params jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ledger_status text;
  v_state public.stripe_subscription_event_state%ROWTYPE;
  v_entity_type text := p_entity_type;
  v_entity_id uuid := p_entity_id;
  v_owner uuid;
  v_expires timestamptz;
  v_notify_purpose text;
  v_notify_message text;
  v_new_state text;
  v_inserted boolean := false;
  v_name text;
BEGIN
  -- ---- validation -------------------------------------------------
  IF p_event_id IS NULL OR length(trim(p_event_id)) = 0 THEN
    RAISE EXCEPTION 'stripe event id required';
  END IF;
  IF p_subscription_id IS NULL OR length(trim(p_subscription_id)) = 0 THEN
    RAISE EXCEPTION 'stripe subscription id required';
  END IF;
  IF p_event_at IS NULL THEN
    RAISE EXCEPTION 'stripe event timestamp required';
  END IF;
  IF p_transition NOT IN ('activate', 'renew', 'update', 'cancel') THEN
    RAISE EXCEPTION 'unsupported transition';
  END IF;

  -- ---- ledger claim must exist and not be complete ------------------
  SELECT status INTO v_ledger_status
  FROM public.stripe_webhook_events
  WHERE stripe_event_id = p_event_id
  FOR UPDATE;

  IF v_ledger_status IS NULL THEN
    RAISE EXCEPTION 'stripe event not claimed';
  END IF;
  IF v_ledger_status = 'completed' THEN
    RETURN jsonb_build_object('result', 'already_applied');
  END IF;

  -- ---- serialize on the durable ordering record ---------------------
  INSERT INTO public.stripe_subscription_event_state (
    stripe_subscription_id, entity_type, entity_id,
    last_event_id, last_event_type, last_event_at, subscription_state
  )
  VALUES (
    p_subscription_id, v_entity_type, v_entity_id,
    p_event_id, coalesce(p_event_type, 'unknown'), p_event_at,
    CASE WHEN p_transition = 'cancel' THEN 'cancelled' ELSE 'active' END
  )
  ON CONFLICT (stripe_subscription_id) DO NOTHING;

  SELECT * INTO v_state
  FROM public.stripe_subscription_event_state
  WHERE stripe_subscription_id = p_subscription_id
  FOR UPDATE;

  v_inserted := (v_state.last_event_id = p_event_id AND v_state.last_event_type = coalesce(p_event_type, 'unknown'));

  IF NOT v_inserted THEN
    -- Same event replayed: idempotent no-op.
    IF v_state.last_event_id = p_event_id THEN
      UPDATE public.stripe_webhook_events
      SET status = 'completed', completed_at = now(), updated_at = now(), last_error = NULL
      WHERE stripe_event_id = p_event_id;
      RETURN jsonb_build_object('result', 'already_applied');
    END IF;

    -- Strictly older, or equal-time losing the deterministic tie-break.
    IF v_state.last_event_at > p_event_at
       OR (v_state.last_event_at = p_event_at AND p_event_id <= v_state.last_event_id) THEN
      UPDATE public.stripe_webhook_events
      SET status = 'completed', completed_at = now(), updated_at = now(), last_error = NULL
      WHERE stripe_event_id = p_event_id;
      RETURN jsonb_build_object('result', 'stale');
    END IF;
  END IF;

  -- ---- resolve entity ----------------------------------------------
  IF v_entity_type IS NULL THEN
    v_entity_type := v_state.entity_type;
    v_entity_id := v_state.entity_id;
  END IF;

  IF v_entity_type IS NULL THEN
    SELECT 'team', team_id INTO v_entity_type, v_entity_id
    FROM public.team_subscriptions
    WHERE stripe_subscription_id = p_subscription_id
    LIMIT 1;
  END IF;

  IF v_entity_type IS NULL THEN
    SELECT 'club', club_id INTO v_entity_type, v_entity_id
    FROM public.club_subscriptions
    WHERE stripe_subscription_id = p_subscription_id
    LIMIT 1;
  END IF;

  IF v_entity_type IS NULL THEN
    SELECT 'club', id INTO v_entity_type, v_entity_id
    FROM public.clubs
    WHERE stripe_subscription_id = p_subscription_id
    LIMIT 1;
  END IF;

  v_expires := nullif(p_params->>'expires_at', '')::timestamptz;

  -- ---- apply the entitlement transition ------------------------------
  IF v_entity_type = 'team' AND v_entity_id IS NOT NULL THEN
    SELECT name, created_by INTO v_name, v_owner FROM public.teams WHERE id = v_entity_id;

    IF p_transition = 'activate' THEN
      INSERT INTO public.team_subscriptions (
        team_id, is_pro, is_pro_football, stripe_subscription_id,
        activated_at, expires_at, is_trial, trial_ends_at,
        last_stripe_event_id, last_stripe_event_at
      ) VALUES (
        v_entity_id, true, coalesce((p_params->>'is_pro_football')::boolean, false), p_subscription_id,
        now(), v_expires,
        coalesce((p_params->>'is_trial')::boolean, false),
        nullif(p_params->>'trial_ends_at', '')::timestamptz,
        p_event_id, p_event_at
      )
      ON CONFLICT (team_id) DO UPDATE SET
        is_pro = true,
        is_pro_football = EXCLUDED.is_pro_football,
        stripe_subscription_id = EXCLUDED.stripe_subscription_id,
        activated_at = EXCLUDED.activated_at,
        expires_at = EXCLUDED.expires_at,
        is_trial = EXCLUDED.is_trial,
        trial_ends_at = EXCLUDED.trial_ends_at,
        last_stripe_event_id = EXCLUDED.last_stripe_event_id,
        last_stripe_event_at = EXCLUDED.last_stripe_event_at;

      UPDATE public.teams
      SET is_pro = true, pro_expires_at = v_expires, stripe_subscription_id = p_subscription_id
      WHERE id = v_entity_id;

      v_notify_purpose := 'subscription_activated';
      v_notify_message := 'Your ' || CASE WHEN coalesce((p_params->>'is_pro_football')::boolean, false)
                                          THEN 'Pro Football' ELSE 'Pro' END
                          || ' subscription has been activated!';
      v_new_state := 'active';

    ELSIF p_transition IN ('renew', 'update') THEN
      UPDATE public.team_subscriptions
      SET expires_at = coalesce(v_expires, expires_at),
          is_trial = CASE WHEN p_transition = 'renew' THEN false ELSE is_trial END,
          trial_ends_at = CASE WHEN p_transition = 'renew' THEN NULL ELSE trial_ends_at END,
          last_stripe_event_id = p_event_id,
          last_stripe_event_at = p_event_at
      WHERE stripe_subscription_id = p_subscription_id;

      UPDATE public.teams SET pro_expires_at = coalesce(v_expires, pro_expires_at)
      WHERE id = v_entity_id;

      IF p_transition = 'renew' THEN
        v_notify_purpose := 'subscription_renewed';
        v_notify_message := 'Your ' || CASE WHEN coalesce((p_params->>'is_pro_football')::boolean, false)
                                            THEN 'Pro Football' ELSE 'Pro' END
                            || ' subscription for ' || coalesce(v_name, 'your team') || ' has been renewed!';
      END IF;
      v_new_state := 'active';

    ELSIF p_transition = 'cancel' THEN
      UPDATE public.team_subscriptions
      SET is_pro = false,
          is_pro_football = false,
          stripe_subscription_id = NULL,
          is_trial = false,
          trial_ends_at = NULL,
          last_stripe_event_id = p_event_id,
          last_stripe_event_at = p_event_at
      WHERE stripe_subscription_id = p_subscription_id OR team_id = v_entity_id;

      UPDATE public.teams
      SET is_pro = false, pro_expires_at = NULL, stripe_subscription_id = NULL
      WHERE id = v_entity_id;

      v_notify_purpose := 'subscription_cancelled';
      v_notify_message := 'Your subscription has been cancelled.';
      v_new_state := 'cancelled';
    END IF;

  ELSIF v_entity_type = 'club' AND v_entity_id IS NOT NULL THEN
    SELECT name, created_by INTO v_name, v_owner FROM public.clubs WHERE id = v_entity_id;

    IF p_transition = 'activate' THEN
      INSERT INTO public.club_subscriptions (
        club_id, is_pro, is_pro_football, plan, team_limit, stripe_subscription_id,
        activated_at, expires_at, last_stripe_event_id, last_stripe_event_at
      ) VALUES (
        v_entity_id, true, coalesce((p_params->>'is_pro_football')::boolean, false),
        nullif(p_params->>'plan', ''),
        nullif(p_params->>'team_limit', '')::integer,
        p_subscription_id, now(), v_expires, p_event_id, p_event_at
      )
      ON CONFLICT (club_id) DO UPDATE SET
        is_pro = true,
        is_pro_football = EXCLUDED.is_pro_football,
        plan = EXCLUDED.plan,
        team_limit = EXCLUDED.team_limit,
        stripe_subscription_id = EXCLUDED.stripe_subscription_id,
        activated_at = EXCLUDED.activated_at,
        expires_at = EXCLUDED.expires_at,
        last_stripe_event_id = EXCLUDED.last_stripe_event_id,
        last_stripe_event_at = EXCLUDED.last_stripe_event_at;

      UPDATE public.clubs SET is_pro = true WHERE id = v_entity_id;

      v_notify_purpose := 'subscription_activated';
      v_notify_message := 'Your Club ' || CASE WHEN coalesce((p_params->>'is_pro_football')::boolean, false)
                                               THEN 'Pro Football' ELSE 'Pro' END
                          || ' subscription has been activated!';
      v_new_state := 'active';

    ELSIF p_transition IN ('renew', 'update') THEN
      UPDATE public.club_subscriptions
      SET expires_at = coalesce(v_expires, expires_at),
          last_stripe_event_id = p_event_id,
          last_stripe_event_at = p_event_at
      WHERE stripe_subscription_id = p_subscription_id;

      IF p_transition = 'renew' THEN
        v_notify_purpose := 'subscription_renewed';
        v_notify_message := 'Your Club ' || CASE WHEN coalesce((p_params->>'is_pro_football')::boolean, false)
                                                 THEN 'Pro Football' ELSE 'Pro' END
                            || ' subscription for ' || coalesce(v_name, 'your club') || ' has been renewed!';
      END IF;
      v_new_state := 'active';

    ELSIF p_transition = 'cancel' THEN
      DELETE FROM public.club_subscriptions
      WHERE stripe_subscription_id = p_subscription_id OR club_id = v_entity_id;

      UPDATE public.clubs
      SET is_pro = false, stripe_subscription_id = NULL
      WHERE id = v_entity_id;

      v_notify_purpose := 'subscription_cancelled';
      v_notify_message := 'Your club subscription has been cancelled.';
      v_new_state := 'cancelled';
    END IF;

  ELSE
    -- No entity resolvable. Still record the ordering watermark so a later
    -- out-of-order event cannot resurrect entitlement.
    v_new_state := CASE WHEN p_transition = 'cancel' THEN 'cancelled' ELSE 'active' END;
  END IF;

  -- ---- durable watermark (survives row deletion / id clearing) --------
  UPDATE public.stripe_subscription_event_state
  SET entity_type = coalesce(v_entity_type, entity_type),
      entity_id = coalesce(v_entity_id, entity_id),
      last_event_id = p_event_id,
      last_event_type = coalesce(p_event_type, 'unknown'),
      last_event_at = p_event_at,
      subscription_state = coalesce(v_new_state, subscription_state),
      updated_at = now()
  WHERE stripe_subscription_id = p_subscription_id;

  -- ---- exactly-once notification outbox --------------------------------
  IF v_notify_purpose IS NOT NULL AND v_owner IS NOT NULL THEN
    INSERT INTO public.stripe_notification_outbox (stripe_event_id, purpose, user_id, entity_type, entity_id)
    VALUES (p_event_id, v_notify_purpose, v_owner, v_entity_type, v_entity_id)
    ON CONFLICT (stripe_event_id, purpose) DO NOTHING;

    IF FOUND THEN
      INSERT INTO public.notifications (user_id, type, message, related_id)
      VALUES (v_owner, v_notify_purpose, v_notify_message, v_entity_id);
    END IF;
  END IF;

  -- ---- complete the webhook ledger in the SAME transaction -------------
  UPDATE public.stripe_webhook_events
  SET status = 'completed', completed_at = now(), updated_at = now(), last_error = NULL
  WHERE stripe_event_id = p_event_id;

  RETURN jsonb_build_object(
    'result', 'applied',
    'entity_type', v_entity_type,
    'entity_id', v_entity_id,
    'owner_user_id', v_owner,
    'entity_name', v_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_stripe_subscription_transition(text, text, timestamptz, text, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_stripe_subscription_transition(text, text, timestamptz, text, text, text, uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.stripe_event_is_stale(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_event_is_stale(text, timestamptz) TO service_role;