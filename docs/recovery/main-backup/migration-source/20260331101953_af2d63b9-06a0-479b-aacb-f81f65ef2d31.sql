
-- Security definer function to approve role requests
-- Only authorized admins/coaches can call this
CREATE OR REPLACE FUNCTION public.approve_role_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request RECORD;
  v_caller_id uuid := auth.uid();
  v_is_authorized boolean := false;
  v_club_id uuid;
BEGIN
  -- Fetch the request
  SELECT * INTO v_request FROM role_requests WHERE id = p_request_id;
  
  IF v_request IS NULL THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  
  IF v_request.status != 'pending' THEN
    RAISE EXCEPTION 'Request already processed';
  END IF;

  -- Determine the club_id
  IF v_request.club_id IS NOT NULL THEN
    v_club_id := v_request.club_id;
  ELSIF v_request.team_id IS NOT NULL THEN
    SELECT club_id INTO v_club_id FROM teams WHERE id = v_request.team_id;
  END IF;

  -- Check authorization: app_admin, club_admin, team_admin, or coach for the relevant team
  SELECT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = v_caller_id
    AND (
      ur.role = 'app_admin'
      OR (ur.role = 'club_admin' AND ur.club_id = v_club_id)
      OR (v_request.team_id IS NOT NULL AND ur.team_id = v_request.team_id AND ur.role IN ('team_admin', 'coach'))
    )
  ) INTO v_is_authorized;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Not authorized to approve this request';
  END IF;

  -- Check if role already exists
  IF NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = v_request.user_id
    AND role = v_request.role
    AND COALESCE(club_id, '00000000-0000-0000-0000-000000000000') = COALESCE(v_request.club_id, v_club_id, '00000000-0000-0000-0000-000000000000')
    AND COALESCE(team_id, '00000000-0000-0000-0000-000000000000') = COALESCE(v_request.team_id, '00000000-0000-0000-0000-000000000000')
  ) THEN
    INSERT INTO user_roles (user_id, role, club_id, team_id)
    VALUES (v_request.user_id, v_request.role, COALESCE(v_request.club_id, v_club_id), v_request.team_id);
  END IF;

  -- Handle child linking from metadata if present
  IF v_request.metadata IS NOT NULL AND v_request.metadata->>'child_id' IS NOT NULL AND v_request.metadata->>'child_id' != '' THEN
    INSERT INTO child_guardians (child_id, guardian_id, relationship_type)
    VALUES ((v_request.metadata->>'child_id')::uuid, v_request.user_id, 'parent')
    ON CONFLICT (child_id, guardian_id) DO NOTHING;
  END IF;

  -- Mark request as approved
  UPDATE role_requests
  SET status = 'approved', processed_by = v_caller_id
  WHERE id = p_request_id;

  -- Create notification for the requester
  INSERT INTO notifications (user_id, type, message, related_id)
  VALUES (
    v_request.user_id,
    'join_request_approved',
    'Your role request has been approved!',
    COALESCE(v_request.team_id, v_request.club_id)
  );
END;
$$;

-- Security definer function to deny role requests
CREATE OR REPLACE FUNCTION public.deny_role_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request RECORD;
  v_caller_id uuid := auth.uid();
  v_is_authorized boolean := false;
  v_club_id uuid;
BEGIN
  SELECT * INTO v_request FROM role_requests WHERE id = p_request_id;
  
  IF v_request IS NULL THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  
  IF v_request.status != 'pending' THEN
    RAISE EXCEPTION 'Request already processed';
  END IF;

  IF v_request.club_id IS NOT NULL THEN
    v_club_id := v_request.club_id;
  ELSIF v_request.team_id IS NOT NULL THEN
    SELECT club_id INTO v_club_id FROM teams WHERE id = v_request.team_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = v_caller_id
    AND (
      ur.role = 'app_admin'
      OR (ur.role = 'club_admin' AND ur.club_id = v_club_id)
      OR (v_request.team_id IS NOT NULL AND ur.team_id = v_request.team_id AND ur.role IN ('team_admin', 'coach'))
    )
  ) INTO v_is_authorized;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Not authorized to deny this request';
  END IF;

  UPDATE role_requests
  SET status = 'denied', processed_by = v_caller_id
  WHERE id = p_request_id;

  INSERT INTO notifications (user_id, type, message, related_id)
  VALUES (
    v_request.user_id,
    'join_request_denied',
    'Your role request has been denied.',
    COALESCE(v_request.team_id, v_request.club_id)
  );
END;
$$;
