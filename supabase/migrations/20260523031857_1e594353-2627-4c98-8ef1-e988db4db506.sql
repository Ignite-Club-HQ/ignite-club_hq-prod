CREATE OR REPLACE FUNCTION public.move_child_to_team(p_child_id uuid, p_from_team_id uuid, p_to_team_id uuid, p_club_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_from_club_id UUID;
  v_to_club_id UUID;
  v_actor_id UUID;
  v_guardian RECORD;
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

  UPDATE child_team_assignments
  SET team_id = p_to_team_id, created_at = now()
  WHERE child_id = p_child_id AND team_id = p_from_team_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Child not found on the source team';
  END IF;

  -- Move guardians (parents) whose only child on the source team was the moved child
  FOR v_guardian IN
    SELECT cg.guardian_id
    FROM child_guardians cg
    WHERE cg.child_id = p_child_id
      AND EXISTS (
        SELECT 1 FROM user_roles ur
        WHERE ur.user_id = cg.guardian_id
          AND ur.team_id = p_from_team_id
          AND ur.role = 'parent'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM child_guardians cg2
        JOIN child_team_assignments cta ON cta.child_id = cg2.child_id
        WHERE cg2.guardian_id = cg.guardian_id
          AND cg2.child_id <> p_child_id
          AND cta.team_id = p_from_team_id
      )
  LOOP
    -- Remove any pre-existing parent row on destination team to avoid duplicates
    DELETE FROM user_roles
    WHERE user_id = v_guardian.guardian_id
      AND team_id = p_to_team_id
      AND role = 'parent';

    UPDATE user_roles
    SET team_id = p_to_team_id
    WHERE user_id = v_guardian.guardian_id
      AND team_id = p_from_team_id
      AND role = 'parent';
  END LOOP;
END;
$function$;