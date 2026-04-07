CREATE OR REPLACE FUNCTION public.move_member_to_team(
  p_user_id UUID,
  p_from_team_id UUID,
  p_to_team_id UUID,
  p_club_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_club_id UUID;
  v_to_club_id UUID;
  v_actor_id UUID;
  v_source_count INT;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  IF NOT (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = v_actor_id AND role = 'club_admin' AND club_id = p_club_id)
    OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = v_actor_id AND role = 'app_admin')
  ) THEN
    RAISE EXCEPTION 'Not authorized: must be club admin or app admin';
  END IF;

  SELECT club_id INTO v_from_club_id FROM teams WHERE id = p_from_team_id;
  SELECT club_id INTO v_to_club_id FROM teams WHERE id = p_to_team_id;
  
  IF v_from_club_id IS NULL OR v_to_club_id IS NULL THEN
    RAISE EXCEPTION 'One or both teams not found';
  END IF;
  
  IF v_from_club_id != p_club_id OR v_to_club_id != p_club_id THEN
    RAISE EXCEPTION 'Both teams must belong to the specified club';
  END IF;

  -- Count source roles to verify member exists on source team
  SELECT COUNT(*) INTO v_source_count
  FROM user_roles
  WHERE user_id = p_user_id AND team_id = p_from_team_id;

  IF v_source_count = 0 THEN
    RAISE EXCEPTION 'No roles found for this user on the source team';
  END IF;

  -- Delete source roles that already exist on the target team (same user_id + role + club_id)
  DELETE FROM user_roles src
  USING user_roles tgt
  WHERE src.user_id = p_user_id
    AND src.team_id = p_from_team_id
    AND tgt.user_id = p_user_id
    AND tgt.team_id = p_to_team_id
    AND src.role = tgt.role
    AND COALESCE(src.club_id, '00000000-0000-0000-0000-000000000000') = COALESCE(tgt.club_id, '00000000-0000-0000-0000-000000000000')
    AND src.id = src.id;

  -- Move remaining source roles to the target team
  UPDATE user_roles 
  SET team_id = p_to_team_id
  WHERE user_id = p_user_id AND team_id = p_from_team_id;
END;
$$;