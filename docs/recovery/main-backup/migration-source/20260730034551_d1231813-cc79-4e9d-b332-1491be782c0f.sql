ALTER TABLE public.reward_redemptions
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS reward_redemptions_user_idem_key
  ON public.reward_redemptions (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.redeem_club_reward(
  _reward_id uuid,
  _child_id uuid DEFAULT NULL,
  _idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_reward record;
  v_existing record;
  v_balance integer;
  v_remaining integer;
  v_redemption_id uuid;
  v_child_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT r.id, r.reward_id, r.club_id, r.points_spent, r.child_id
      INTO v_existing
      FROM public.reward_redemptions r
     WHERE r.user_id = v_uid AND r.idempotency_key = _idempotency_key;
    IF FOUND THEN
      IF v_existing.child_id IS NULL THEN
        v_remaining := public.get_user_club_points(v_uid, v_existing.club_id);
      ELSE
        v_remaining := public.get_child_club_points(v_existing.child_id, v_existing.club_id);
      END IF;
      SELECT c.name INTO v_child_name FROM public.children c WHERE c.id = v_existing.child_id;
      RETURN jsonb_build_object(
        'redemption_id', v_existing.id,
        'reward_id', v_existing.reward_id,
        'club_id', v_existing.club_id,
        'points_spent', v_existing.points_spent,
        'remaining_points', v_remaining,
        'child_id', v_existing.child_id,
        'child_name', v_child_name,
        'replayed', true
      );
    END IF;
  END IF;

  SELECT cr.id, cr.club_id, cr.points_required, cr.name, cr.is_active
    INTO v_reward
    FROM public.club_rewards cr
   WHERE cr.id = _reward_id;

  IF NOT FOUND OR v_reward.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Reward is not available' USING ERRCODE = 'P0002';
  END IF;
  IF v_reward.club_id IS NULL THEN
    RAISE EXCEPTION 'Reward is not linked to a club' USING ERRCODE = '22023';
  END IF;

  IF _child_id IS NOT NULL THEN
    SELECT c.name INTO v_child_name FROM public.children c WHERE c.id = _child_id;
    IF v_child_name IS NULL THEN
      RAISE EXCEPTION 'Child not found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.children c
       WHERE c.id = _child_id AND c.parent_id = v_uid
      UNION ALL
      SELECT 1 FROM public.child_guardians g
       WHERE g.child_id = _child_id AND g.guardian_id = v_uid
    ) THEN
      RAISE EXCEPTION 'Not authorised to redeem for this child' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.child_club_points (child_id, club_id, points, updated_at)
    VALUES (_child_id, v_reward.club_id, 0, now())
    ON CONFLICT (child_id, club_id) DO NOTHING;

    SELECT points INTO v_balance
      FROM public.child_club_points
     WHERE child_id = _child_id AND club_id = v_reward.club_id
     FOR UPDATE;
  ELSE
    INSERT INTO public.user_club_points (user_id, club_id, points, updated_at)
    VALUES (v_uid, v_reward.club_id, 0, now())
    ON CONFLICT (user_id, club_id) DO NOTHING;

    SELECT points INTO v_balance
      FROM public.user_club_points
     WHERE user_id = v_uid AND club_id = v_reward.club_id
     FOR UPDATE;
  END IF;

  v_balance := COALESCE(v_balance, 0);

  IF v_balance < v_reward.points_required THEN
    RAISE EXCEPTION 'Not enough points' USING ERRCODE = 'P0001';
  END IF;

  v_remaining := v_balance - v_reward.points_required;

  IF _child_id IS NOT NULL THEN
    UPDATE public.child_club_points
       SET points = v_remaining, updated_at = now()
     WHERE child_id = _child_id AND club_id = v_reward.club_id;

    UPDATE public.children
       SET ignite_points = GREATEST(0, COALESCE(ignite_points, 0) - v_reward.points_required)
     WHERE id = _child_id;
  ELSE
    UPDATE public.user_club_points
       SET points = v_remaining, updated_at = now()
     WHERE user_id = v_uid AND club_id = v_reward.club_id;

    UPDATE public.profiles
       SET ignite_points = GREATEST(0, COALESCE(ignite_points, 0) - v_reward.points_required)
     WHERE id = v_uid;
  END IF;

  INSERT INTO public.reward_redemptions (reward_id, user_id, child_id, club_id, points_spent, idempotency_key)
  VALUES (_reward_id, v_uid, _child_id, v_reward.club_id, v_reward.points_required, _idempotency_key)
  RETURNING id INTO v_redemption_id;

  INSERT INTO public.points_history (user_id, child_id, club_id, amount, balance_after, source_type, source_id, description, created_by)
  VALUES (
    CASE WHEN _child_id IS NULL THEN v_uid ELSE NULL END,
    _child_id,
    v_reward.club_id,
    -v_reward.points_required,
    v_remaining,
    'redemption',
    _reward_id,
    'Redeemed: ' || v_reward.name,
    v_uid
  );

  RETURN jsonb_build_object(
    'redemption_id', v_redemption_id,
    'reward_id', _reward_id,
    'club_id', v_reward.club_id,
    'points_spent', v_reward.points_required,
    'remaining_points', v_remaining,
    'child_id', _child_id,
    'child_name', v_child_name,
    'replayed', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.redeem_club_reward(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_club_reward(uuid, uuid, text) TO authenticated;