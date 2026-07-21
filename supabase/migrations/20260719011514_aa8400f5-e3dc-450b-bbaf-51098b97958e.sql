CREATE OR REPLACE FUNCTION public.approve_role_request(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_request RECORD;
  v_caller_id uuid := auth.uid();
  v_is_authorized boolean := false;
  v_club_id uuid;
  v_target_name text;
  v_child_id_text text;
  v_child_id uuid;
  v_child_exists boolean;
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
    RAISE EXCEPTION 'Not authorized to approve this request';
  END IF;

  INSERT INTO user_roles (user_id, role, club_id, team_id)
  VALUES (v_request.user_id, v_request.role, v_request.club_id, v_request.team_id)
  ON CONFLICT DO NOTHING;

  -- If this is a parent role request that carries a real child_id in metadata,
  -- also link the requester as a (non-primary) guardian of that child. Without
  -- this, the requester gets the team role but RLS still blocks RSVPs for the
  -- child (child_guardians is the source of truth).
  IF v_request.role::text = 'parent'
     AND v_request.metadata IS NOT NULL
     AND v_request.metadata ? 'child_id'
  THEN
    v_child_id_text := v_request.metadata->>'child_id';
    -- Skip placeholders like 'pending-...'
    IF v_child_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_child_id := v_child_id_text::uuid;
      SELECT EXISTS (SELECT 1 FROM children WHERE id = v_child_id) INTO v_child_exists;
      IF v_child_exists THEN
        INSERT INTO child_guardians (child_id, guardian_id, is_primary)
        VALUES (v_child_id, v_request.user_id, false)
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;

  UPDATE role_requests
  SET status = 'approved', processed_by = v_caller_id
  WHERE id = p_request_id;

  SELECT display_name INTO v_target_name FROM profiles WHERE id = v_request.user_id;

  INSERT INTO audit_logs (action_type, actor_id, target_user_id, target_user_name, details)
  VALUES (
    'role_request_approved',
    v_caller_id,
    v_request.user_id,
    v_target_name,
    jsonb_build_object(
      'request_id', p_request_id,
      'club_id', v_request.club_id,
      'team_id', v_request.team_id,
      'role', v_request.role::text,
      'child_id', v_request.metadata->>'child_id'
    )
  );

  INSERT INTO notifications (user_id, type, message, related_id)
  VALUES (
    v_request.user_id,
    'join_request_approved',
    'Your role request has been approved.',
    COALESCE(v_request.team_id, v_request.club_id)
  );
END;
$function$;