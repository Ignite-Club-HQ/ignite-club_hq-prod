CREATE OR REPLACE FUNCTION public.deny_role_request(p_request_id uuid)
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

  SELECT display_name INTO v_target_name FROM profiles WHERE id = v_request.user_id;

  INSERT INTO audit_logs (action_type, actor_id, target_user_id, target_user_name, details)
  VALUES (
    'role_request_denied',
    v_caller_id,
    v_request.user_id,
    v_target_name,
    jsonb_build_object(
      'request_id', p_request_id,
      'club_id', v_request.club_id,
      'team_id', v_request.team_id,
      'role', v_request.role::text
    )
  );

  INSERT INTO notifications (user_id, type, message, related_id)
  VALUES (
    v_request.user_id,
    'join_request_denied',
    'Your role request has been denied.',
    COALESCE(v_request.team_id, v_request.club_id)
  );
END;
$function$;

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
      'role', v_request.role::text
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