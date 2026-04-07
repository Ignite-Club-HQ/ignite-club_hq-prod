
-- RPC to move an adult member (user_roles) from one team to another within the same club
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
  -- Verify actor is club_admin or app_admin
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

  -- Verify both teams belong to the same club
  SELECT club_id INTO v_from_club_id FROM teams WHERE id = p_from_team_id;
  SELECT club_id INTO v_to_club_id FROM teams WHERE id = p_to_team_id;
  
  IF v_from_club_id IS NULL OR v_to_club_id IS NULL THEN
    RAISE EXCEPTION 'One or both teams not found';
  END IF;
  
  IF v_from_club_id != p_club_id OR v_to_club_id != p_club_id THEN
    RAISE EXCEPTION 'Both teams must belong to the specified club';
  END IF;

  -- Move all roles from source team to target team
  UPDATE user_roles 
  SET team_id = p_to_team_id, updated_at = now()
  WHERE user_id = p_user_id AND team_id = p_from_team_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No roles found for this user on the source team';
  END IF;
END;
$$;

-- RPC to move a child from one team to another within the same club
CREATE OR REPLACE FUNCTION public.move_child_to_team(
  p_child_id UUID,
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
  -- Verify actor is club_admin or app_admin
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

  -- Verify both teams belong to the same club
  SELECT club_id INTO v_from_club_id FROM teams WHERE id = p_from_team_id;
  SELECT club_id INTO v_to_club_id FROM teams WHERE id = p_to_team_id;
  
  IF v_from_club_id IS NULL OR v_to_club_id IS NULL THEN
    RAISE EXCEPTION 'One or both teams not found';
  END IF;
  
  IF v_from_club_id != p_club_id OR v_to_club_id != p_club_id THEN
    RAISE EXCEPTION 'Both teams must belong to the specified club';
  END IF;

  -- Move child assignment
  UPDATE child_team_assignments 
  SET team_id = p_to_team_id, created_at = now()
  WHERE child_id = p_child_id AND team_id = p_from_team_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Child not found on the source team';
  END IF;
END;
$$;
