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

  UPDATE user_roles 
  SET team_id = p_to_team_id
  WHERE user_id = p_user_id AND team_id = p_from_team_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No roles found for this user on the source team';
  END IF;
END;
$$;