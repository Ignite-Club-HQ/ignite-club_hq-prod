CREATE OR REPLACE FUNCTION public.accept_guardian_parent_invite(_invite_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _invite public.pending_invites%ROWTYPE;
  _meta jsonb;
  _child_id uuid;
  _team_id uuid;
  _team_ids uuid[];
  _team_club_id uuid;
  _club_id uuid;
  _child_exists boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _invite
  FROM public.pending_invites
  WHERE id = _invite_id
    AND invited_user_id = _uid
    AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found_or_not_pending' USING ERRCODE = 'P0002';
  END IF;

  IF _invite.role <> 'parent' THEN
    RAISE EXCEPTION 'invalid_role_for_guardian_accept' USING ERRCODE = '22023';
  END IF;

  _meta := COALESCE(_invite.metadata, '{}'::jsonb);
  _child_id := NULLIF(_meta->>'guardian_child_id','')::uuid;

  IF _child_id IS NULL THEN
    RAISE EXCEPTION 'not_a_guardian_invite' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.children WHERE id = _child_id) INTO _child_exists;
  IF NOT _child_exists THEN
    RAISE EXCEPTION 'child_not_found' USING ERRCODE = 'P0002';
  END IF;

  _club_id := _invite.club_id;
  IF _club_id IS NULL AND _invite.team_id IS NOT NULL THEN
    SELECT club_id INTO _club_id FROM public.teams WHERE id = _invite.team_id;
  END IF;

  -- Required guardian link. Uncaught errors abort the whole function
  -- (parent role writes and the invite update roll back with it).
  -- A genuine pre-existing (child_id, guardian_id) row is treated as
  -- idempotent success.
  BEGIN
    INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
    VALUES (_child_id, _uid, 'parent', false);
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  -- Resolve target team ids
  IF (_meta ? 'guardian_all_team_ids')
     AND jsonb_typeof(_meta->'guardian_all_team_ids') = 'array' THEN
    SELECT COALESCE(array_agg((v)::uuid), ARRAY[]::uuid[])
    INTO _team_ids
    FROM jsonb_array_elements_text(_meta->'guardian_all_team_ids') v;
  ELSIF _invite.team_id IS NOT NULL THEN
    _team_ids := ARRAY[_invite.team_id];
  ELSE
    SELECT COALESCE(array_agg(team_id), ARRAY[]::uuid[])
    INTO _team_ids
    FROM public.child_team_assignments
    WHERE child_id = _child_id;
  END IF;

  IF _team_ids IS NOT NULL THEN
    FOREACH _team_id IN ARRAY _team_ids LOOP
      SELECT club_id INTO _team_club_id FROM public.teams WHERE id = _team_id;

      INSERT INTO public.user_roles (user_id, role, team_id, club_id)
      SELECT _uid, 'parent'::app_role, _team_id, COALESCE(_team_club_id, _club_id)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = _uid
          AND role = 'parent'::app_role
          AND team_id = _team_id
      );
    END LOOP;
  END IF;

  -- Club-only guardian invite: ensure a club-scoped parent role exists
  IF _invite.team_id IS NULL AND _club_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role, team_id, club_id)
    SELECT _uid, 'parent'::app_role, NULL, _club_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _uid
        AND role = 'parent'::app_role
        AND team_id IS NULL
        AND club_id = _club_id
    );
  END IF;

  UPDATE public.pending_invites
  SET status = 'accepted',
      accepted_at = now(),
      invited_user_id = _uid
  WHERE id = _invite_id;

  RETURN jsonb_build_object(
    'success', true,
    'invite_id', _invite_id,
    'child_id', _child_id,
    'team_ids', to_jsonb(COALESCE(_team_ids, ARRAY[]::uuid[]))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_guardian_parent_invite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_guardian_parent_invite(uuid) TO authenticated;