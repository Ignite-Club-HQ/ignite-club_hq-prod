-- Reconcile pending invites: match ghost pending invites to active members by email
-- Returns the count of invites reconciled. Only callable by users with admin authority
-- over the target team or club (team_admin/coach for the team; club_admin/app_admin for the club).
CREATE OR REPLACE FUNCTION public.reconcile_pending_invites(
  _team_id uuid DEFAULT NULL,
  _club_id uuid DEFAULT NULL
)
RETURNS TABLE(reconciled_count integer, skipped_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_authorized boolean := false;
  v_reconciled integer := 0;
  v_skipped integer := 0;
  v_resolved_club_id uuid;
  inv RECORD;
  v_matched_user uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _team_id IS NULL AND _club_id IS NULL THEN
    RAISE EXCEPTION 'Must provide team_id or club_id';
  END IF;

  -- Resolve club for the team if needed
  IF _team_id IS NOT NULL AND _club_id IS NULL THEN
    SELECT club_id INTO v_resolved_club_id FROM public.teams WHERE id = _team_id;
  ELSE
    v_resolved_club_id := _club_id;
  END IF;

  -- Authorization: app_admin OR club_admin of the club OR team admin/coach of the team
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_caller
      AND (
        role = 'app_admin'
        OR (role = 'club_admin' AND club_id = v_resolved_club_id)
        OR (_team_id IS NOT NULL AND team_id = _team_id AND role IN ('team_admin','coach'))
      )
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Not authorized to reconcile invites for this team/club';
  END IF;

  -- Iterate over pending invites for the scope
  FOR inv IN
    SELECT pi.id, pi.invited_user_id, pi.invited_email
    FROM public.pending_invites pi
    WHERE pi.status = 'pending'
      AND (
        (_team_id IS NOT NULL AND pi.team_id = _team_id)
        OR (_team_id IS NULL AND _club_id IS NOT NULL AND pi.club_id = _club_id AND pi.team_id IS NULL)
      )
  LOOP
    v_matched_user := NULL;

    -- 1) Direct user_id match against active members of this team/club
    IF inv.invited_user_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = inv.invited_user_id
          AND (
            (_team_id IS NOT NULL AND ur.team_id = _team_id)
            OR (_team_id IS NULL AND _club_id IS NOT NULL AND ur.club_id = _club_id)
          )
      ) THEN
        v_matched_user := inv.invited_user_id;
      END IF;
    END IF;

    -- 2) Email match against active members
    IF v_matched_user IS NULL AND inv.invited_email IS NOT NULL THEN
      SELECT au.id INTO v_matched_user
      FROM auth.users au
      JOIN public.user_roles ur ON ur.user_id = au.id
      WHERE lower(au.email) = lower(inv.invited_email)
        AND (
          (_team_id IS NOT NULL AND ur.team_id = _team_id)
          OR (_team_id IS NULL AND _club_id IS NOT NULL AND ur.club_id = _club_id)
        )
      LIMIT 1;
    END IF;

    IF v_matched_user IS NOT NULL THEN
      UPDATE public.pending_invites
      SET status = 'accepted',
          accepted_at = now(),
          invited_user_id = v_matched_user
      WHERE id = inv.id;
      v_reconciled := v_reconciled + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  -- Audit log entry
  INSERT INTO public.audit_logs (action_type, actor_id, details)
  VALUES (
    'pending_invites_reconciled',
    v_caller,
    jsonb_build_object(
      'team_id', _team_id,
      'club_id', v_resolved_club_id,
      'reconciled', v_reconciled,
      'skipped', v_skipped
    )
  );

  RETURN QUERY SELECT v_reconciled, v_skipped;
END;
$$;

-- Permissions: authenticated users can call; function enforces its own authorization
GRANT EXECUTE ON FUNCTION public.reconcile_pending_invites(uuid, uuid) TO authenticated;