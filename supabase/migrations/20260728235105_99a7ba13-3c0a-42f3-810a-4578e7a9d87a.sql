CREATE OR REPLACE FUNCTION public.create_team_with_creator_admin(
  p_club_id uuid,
  p_name text,
  p_level_age text DEFAULT NULL,
  p_default_rsvp_audience text DEFAULT 'players_and_parents'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_team_id uuid;
  v_name text := NULLIF(BTRIM(p_name), '');
  v_level_age text := NULLIF(BTRIM(COALESCE(p_level_age, '')), '');
  v_default_rsvp_audience text := COALESCE(NULLIF(BTRIM(p_default_rsvp_audience), ''), 'players_and_parents');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF p_club_id IS NULL THEN
    RAISE EXCEPTION 'Club is required' USING ERRCODE = '22023';
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Team name is required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.clubs c
    WHERE c.id = p_club_id
      AND c.deleted_at IS NULL
      AND (
        public.has_role(v_user_id, 'club_admin'::public.app_role, c.id, NULL::uuid)
        OR public.has_role(v_user_id, 'app_admin'::public.app_role, NULL::uuid, NULL::uuid)
      )
  ) THEN
    RAISE EXCEPTION 'You are not allowed to create teams for this club' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.teams (
    club_id,
    name,
    level_age,
    team_type,
    created_by,
    default_rsvp_audience
  ) VALUES (
    p_club_id,
    v_name,
    v_level_age,
    'mixed',
    v_user_id,
    v_default_rsvp_audience
  )
  RETURNING id INTO v_team_id;

  INSERT INTO public.user_roles (
    user_id,
    role,
    club_id,
    team_id
  ) VALUES (
    v_user_id,
    'team_admin'::public.app_role,
    p_club_id,
    v_team_id
  );

  RETURN v_team_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_team_with_creator_admin(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_team_with_creator_admin(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_team_with_creator_admin(uuid, text, text, text) TO service_role;