
CREATE OR REPLACE FUNCTION public.admin_link_child_to_parent(
  p_child_name text,
  p_existing_child_id uuid,
  p_parent_user_id uuid,
  p_team_id uuid,
  p_club_id uuid,
  p_pending_invite_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_child_id uuid;
  v_caller_id uuid := auth.uid();
  v_is_authorized boolean := false;
BEGIN
  -- Authorization: caller must be team_admin, club_admin, or app_admin
  SELECT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = v_caller_id
    AND (
      ur.role = 'app_admin'
      OR (ur.role = 'club_admin' AND ur.club_id = p_club_id)
      OR (ur.role = 'team_admin' AND ur.team_id = p_team_id)
    )
  ) INTO v_is_authorized;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  IF p_existing_child_id IS NOT NULL THEN
    -- Child exists — update parent_id
    UPDATE children SET parent_id = p_parent_user_id WHERE id = p_existing_child_id;
    v_child_id := p_existing_child_id;
  ELSE
    -- Create child record
    INSERT INTO children (name, parent_id)
    VALUES (p_child_name, p_parent_user_id)
    RETURNING id INTO v_child_id;

    -- Assign child to team
    INSERT INTO child_team_assignments (child_id, team_id)
    VALUES (v_child_id, p_team_id)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Ensure parent has parent role on the team
  INSERT INTO user_roles (user_id, team_id, club_id, role)
  VALUES (p_parent_user_id, p_team_id, p_club_id, 'parent')
  ON CONFLICT DO NOTHING;

  -- Mark pending invites as accepted
  IF p_pending_invite_ids IS NOT NULL AND array_length(p_pending_invite_ids, 1) > 0 THEN
    UPDATE pending_invites
    SET status = 'accepted',
        accepted_at = now(),
        invited_user_id = p_parent_user_id
    WHERE id = ANY(p_pending_invite_ids)
      AND status = 'pending';
  END IF;
END;
$$;
