CREATE OR REPLACE FUNCTION public.enable_ai_catch_up_for_all_club_members(p_club_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_authorized boolean;
  v_updated integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT
    public.has_role(v_caller, 'app_admin')
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = v_caller
        AND ur.club_id = p_club_id
        AND ur.role IN ('club_admin','committee_member')
    )
  INTO v_authorized;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  WITH club_user_ids AS (
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.club_id = p_club_id
    UNION
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    JOIN public.teams t ON t.id = ur.team_id
    WHERE t.club_id = p_club_id
  )
  UPDATE public.profiles p
  SET ai_catch_up_enabled = true
  FROM club_user_ids c
  WHERE p.id = c.user_id
    AND COALESCE(p.ai_catch_up_enabled, false) = false;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enable_ai_catch_up_for_all_club_members(uuid) TO authenticated;