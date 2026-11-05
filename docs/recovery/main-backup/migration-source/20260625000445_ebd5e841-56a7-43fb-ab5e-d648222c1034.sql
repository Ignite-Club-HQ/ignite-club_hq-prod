CREATE OR REPLACE FUNCTION public.app_admin_enable_ai_catch_up_for_pro_clubs(
  p_club_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_target_clubs uuid[];
  v_clubs_updated integer := 0;
  v_members_updated integer := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_role(v_caller, 'app_admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Resolve target clubs: only Pro / Pro Football with active subscription
  SELECT COALESCE(array_agg(c.id), ARRAY[]::uuid[])
  INTO v_target_clubs
  FROM public.clubs c
  JOIN public.club_subscriptions s ON s.club_id = c.id
  WHERE (p_club_ids IS NULL OR c.id = ANY(p_club_ids))
    AND (s.is_pro OR s.is_pro_football OR s.admin_pro_override OR s.admin_pro_football_override)
    AND (s.expires_at IS NULL OR s.expires_at > now());

  IF array_length(v_target_clubs, 1) IS NULL THEN
    RETURN jsonb_build_object('clubs_updated', 0, 'members_updated', 0);
  END IF;

  -- Enable at club level
  UPDATE public.clubs
  SET ai_catch_up_enabled = true
  WHERE id = ANY(v_target_clubs)
    AND COALESCE(ai_catch_up_enabled, false) = false;
  GET DIAGNOSTICS v_clubs_updated = ROW_COUNT;

  -- Enable on each member's profile
  WITH member_ids AS (
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.club_id = ANY(v_target_clubs)
    UNION
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    JOIN public.teams t ON t.id = ur.team_id
    WHERE t.club_id = ANY(v_target_clubs)
  )
  UPDATE public.profiles p
  SET ai_catch_up_enabled = true
  FROM member_ids m
  WHERE p.id = m.user_id
    AND COALESCE(p.ai_catch_up_enabled, false) = false;
  GET DIAGNOSTICS v_members_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'clubs_updated', v_clubs_updated,
    'members_updated', v_members_updated,
    'total_pro_clubs', array_length(v_target_clubs, 1)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.app_admin_enable_ai_catch_up_for_pro_clubs(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_admin_enable_ai_catch_up_for_pro_clubs(uuid[]) TO authenticated;