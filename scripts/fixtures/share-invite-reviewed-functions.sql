-- DEV catalog definitions for socket-only tests; never deployment input.
CREATE OR REPLACE FUNCTION public.accept_parent_team_invite(_invite_id uuid DEFAULT NULL::uuid, _invite_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _user_email text;
  _invite public.pending_invites%ROWTYPE;
  _meta jsonb;
  _children jsonb;
  _entry jsonb;
  _club_id uuid;
  _team_id uuid;
  _mini_league_id uuid;
  _second_parent uuid;
  _name text;
  _yob int;
  _existing_child_id uuid;
  _child_id uuid;
  _canonical_id uuid;
  _assigned boolean;
  _child_ids uuid[] := ARRAY[]::uuid[];
  _child_club_ok boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF _invite_id IS NULL AND _invite_token IS NULL THEN
    RAISE EXCEPTION 'invite_reference_required' USING ERRCODE = '22023';
  END IF;

  SELECT email INTO _user_email FROM auth.users WHERE id = _uid;

  SELECT * INTO _invite
  FROM public.pending_invites
  WHERE (_invite_id IS NOT NULL AND id = _invite_id)
     OR (_invite_id IS NULL AND invite_token = _invite_token)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF _invite.status <> 'pending' THEN
    -- Idempotent retry: the same user re-running an already accepted invite is a no-op.
    IF _invite.status = 'accepted' AND _invite.invited_user_id = _uid THEN
      RETURN jsonb_build_object('success', true, 'already_accepted', true, 'invite_id', _invite.id);
    END IF;
    RAISE EXCEPTION 'invite_not_pending' USING ERRCODE = '22023';
  END IF;

  -- Ownership: never trust a client-supplied user id.
  IF NOT COALESCE((
    _invite.invited_user_id = _uid
    OR (
      _invite.invited_user_id IS NULL
      AND (
        (NULLIF(btrim(_invite.invited_email), '') IS NOT NULL AND _user_email IS NOT NULL
         AND lower(btrim(_invite.invited_email)) = lower(btrim(_user_email)))
        OR (NULLIF(btrim(_invite.invited_email), '') IS NULL
            AND NULLIF(btrim(_invite_token), '') IS NOT NULL
            AND _invite.invite_token = _invite_token)
      )
    )
  ), false) THEN
    RAISE EXCEPTION 'invite_not_for_this_user' USING ERRCODE = '42501';
  END IF;

  IF _invite.role <> 'parent' THEN
    RAISE EXCEPTION 'invalid_role_for_parent_accept' USING ERRCODE = '22023';
  END IF;

  _meta := COALESCE(_invite.metadata, '{}'::jsonb);

  IF jsonb_typeof(_meta->'children') <> 'array'
     OR jsonb_array_length(_meta->'children') = 0 THEN
    RAISE EXCEPTION 'not_a_child_parent_invite' USING ERRCODE = '22023';
  END IF;

  -- Reusable share links are never consumed by this RPC.
  IF COALESCE(_meta->>'kind','') IN ('mini_league_parent_join_link','league_admin_join_link') THEN
    RAISE EXCEPTION 'reusable_join_link_not_supported' USING ERRCODE = '22023';
  END IF;

  _children := _meta->'children';
  _team_id := _invite.team_id;
  _club_id := _invite.club_id;
  _mini_league_id := NULLIF(_meta->>'mini_league_id','')::uuid;
  _second_parent := NULLIF(_meta->>'second_parent_user_id','')::uuid;

  IF _team_id IS NOT NULL THEN
    SELECT club_id INTO _club_id FROM public.teams WHERE id = _team_id;
    IF _club_id IS NULL THEN
      RAISE EXCEPTION 'invite_team_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF _invite.club_id IS NOT NULL AND _invite.club_id <> _club_id THEN
      RAISE EXCEPTION 'invite_scope_mismatch' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Validate every child entry BEFORE mutating anything.
  FOR _entry IN SELECT jsonb_array_elements(_children) LOOP
    _name := btrim(COALESCE(_entry->>'name',''));
    IF _name = '' THEN
      RAISE EXCEPTION 'invalid_child_name' USING ERRCODE = '22023';
    END IF;

    IF (_entry ? 'yearOfBirth') AND _entry->>'yearOfBirth' IS NOT NULL THEN
      BEGIN
        _yob := (_entry->>'yearOfBirth')::int;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'invalid_child_year_of_birth' USING ERRCODE = '22023';
      END;
    END IF;

    _existing_child_id := NULLIF(_entry->>'existingChildId','')::uuid;
    IF _existing_child_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.children WHERE id = _existing_child_id) THEN
        RAISE EXCEPTION 'referenced_child_not_found' USING ERRCODE = 'P0002';
      END IF;

      -- The referenced child must already sit inside the invitation's club/team scope.
      SELECT EXISTS (
        SELECT 1
        FROM public.child_team_assignments cta
        JOIN public.teams t ON t.id = cta.team_id
        WHERE cta.child_id = _existing_child_id
          AND (
            (_team_id IS NOT NULL AND cta.team_id = _team_id)
            OR (_club_id IS NOT NULL AND t.club_id = _club_id)
          )
      ) OR EXISTS (
        SELECT 1
        FROM public.child_mini_league_assignments cml
        JOIN public.mini_leagues ml ON ml.id = cml.mini_league_id
        WHERE cml.child_id = _existing_child_id
          AND _club_id IS NOT NULL
          AND ml.club_id = _club_id
      )
      INTO _child_club_ok;

      IF NOT COALESCE(_child_club_ok, false) THEN
        RAISE EXCEPTION 'referenced_child_out_of_scope' USING ERRCODE = '42501';
      END IF;
    END IF;
  END LOOP;

  -- Apply.
  FOR _entry IN SELECT jsonb_array_elements(_children) LOOP
    _name := btrim(_entry->>'name');
    _yob := NULLIF(_entry->>'yearOfBirth','')::int;
    _existing_child_id := NULLIF(_entry->>'existingChildId','')::uuid;
    _child_id := NULL;

    IF _existing_child_id IS NOT NULL THEN
      _child_id := _existing_child_id;
      INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
      VALUES (_child_id, _uid, 'parent', false)
      ON CONFLICT DO NOTHING;
    ELSE
      -- Reuse an existing child of this parent (owned or guardian-linked).
      SELECT c.id INTO _child_id
      FROM public.children c
      WHERE lower(btrim(c.name)) = lower(_name)
        AND (
          c.parent_id = _uid
          OR EXISTS (
            SELECT 1 FROM public.child_guardians g
            WHERE g.child_id = c.id AND g.guardian_id = _uid
          )
        )
      ORDER BY (c.parent_id = _uid) DESC, c.created_at ASC
      LIMIT 1;

      IF _child_id IS NULL THEN
        INSERT INTO public.children (parent_id, name, year_of_birth)
        VALUES (_uid, _name, _yob)
        RETURNING id INTO _child_id;
      END IF;
    END IF;

    IF _child_id IS NULL THEN
      RAISE EXCEPTION 'child_create_failed' USING ERRCODE = 'P0002';
    END IF;

    -- Team assignment. The dedupe trigger may swallow the insert and merge this
    -- child into the canonical roster child, so verify and re-resolve.
    IF _team_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.child_team_assignments
        WHERE child_id = _child_id AND team_id = _team_id
      ) THEN
        BEGIN
          INSERT INTO public.child_team_assignments (child_id, team_id)
          VALUES (_child_id, _team_id);
        EXCEPTION WHEN unique_violation THEN
          NULL;
        END;
      END IF;

      SELECT EXISTS (
        SELECT 1 FROM public.child_team_assignments
        WHERE child_id = _child_id AND team_id = _team_id
      ) INTO _assigned;

      IF NOT _assigned THEN
        SELECT cta.child_id INTO _canonical_id
        FROM public.child_team_assignments cta
        JOIN public.children c ON c.id = cta.child_id
        WHERE cta.team_id = _team_id
          AND lower(btrim(c.name)) = lower(_name)
        LIMIT 1;

        IF _canonical_id IS NULL THEN
          RAISE EXCEPTION 'child_team_assignment_failed' USING ERRCODE = 'P0002';
        END IF;

        _child_id := _canonical_id;
        INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
        VALUES (_child_id, _uid, 'parent', false)
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;

    -- The accepting user must end up linked to the surviving child.
    IF NOT EXISTS (
      SELECT 1 FROM public.child_guardians
      WHERE child_id = _child_id AND guardian_id = _uid
    ) AND NOT EXISTS (
      SELECT 1 FROM public.children WHERE id = _child_id AND parent_id = _uid
    ) THEN
      INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
      VALUES (_child_id, _uid, 'parent', false)
      ON CONFLICT DO NOTHING;
    END IF;

    IF _mini_league_id IS NOT NULL THEN
      INSERT INTO public.child_mini_league_assignments (child_id, mini_league_id, ability_rating)
      SELECT _child_id, _mini_league_id, 3
      WHERE NOT EXISTS (
        SELECT 1 FROM public.child_mini_league_assignments
        WHERE child_id = _child_id AND mini_league_id = _mini_league_id
      );

      IF NULLIF(_meta->>'player_id','') IS NOT NULL THEN
        UPDATE public.mini_league_players
        SET parent_user_id = _uid, child_id = _child_id
        WHERE id = (_meta->>'player_id')::uuid;
      END IF;
    END IF;

    IF _second_parent IS NOT NULL AND _second_parent <> _uid THEN
      INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
      VALUES (_child_id, _second_parent, 'parent', false)
      ON CONFLICT DO NOTHING;
    END IF;

    IF NOT (_child_id = ANY(_child_ids)) THEN
      _child_ids := array_append(_child_ids, _child_id);
    END IF;
  END LOOP;

  -- Parent membership.
  IF _team_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role, team_id, club_id)
    SELECT _uid, 'parent'::app_role, _team_id, _club_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _uid AND role = 'parent'::app_role AND team_id = _team_id
    );
  ELSIF _club_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role, team_id, club_id)
    SELECT _uid, 'parent'::app_role, NULL, _club_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _uid AND role = 'parent'::app_role
        AND team_id IS NULL AND club_id = _club_id
    );
  ELSE
    RAISE EXCEPTION 'invite_scope_missing' USING ERRCODE = '22023';
  END IF;

  UPDATE public.pending_invites
  SET status = 'accepted',
      accepted_at = now(),
      invited_user_id = _uid
  WHERE id = _invite.id;

  RETURN jsonb_build_object(
    'success', true,
    'invite_id', _invite.id,
    'team_id', _team_id,
    'club_id', _club_id,
    'child_ids', to_jsonb(_child_ids)
  );
END;
$function$

CREATE OR REPLACE FUNCTION public.auto_accept_pending_invites_on_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_email text;
  r record;
  v_child uuid;
  v_league uuid;
  v_player uuid;
  a record;
BEGIN
  SELECT lower(btrim(au.email)) INTO v_email
  FROM auth.users au
  WHERE au.id = NEW.user_id;

  -- Preserve the existing mini-league parent-claim path.
  FOR r IN
    SELECT pi.*
    FROM public.pending_invites pi
    WHERE pi.status = 'pending' AND (NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = NEW.user_id AND NULLIF(btrim(au.raw_user_meta_data->>'email_signup_invite_token'), '') IS NOT NULL) OR pi.invite_token = (SELECT au.raw_user_meta_data->>'email_signup_invite_token' FROM auth.users au WHERE au.id = NEW.user_id))
      AND pi.role::text = 'parent'
      AND (
        pi.invited_user_id = NEW.user_id
        OR (v_email IS NOT NULL AND lower(btrim(pi.invited_email)) = v_email)
      )
      AND (
        (NEW.team_id IS NOT NULL AND pi.team_id = NEW.team_id)
        OR (NEW.team_id IS NULL AND NEW.club_id IS NOT NULL AND pi.club_id = NEW.club_id AND pi.team_id IS NULL)
      )
      AND pi.metadata ? 'mini_league_id'
      AND pi.metadata ? 'child_id'
  LOOP
    v_child := NULLIF(btrim(r.metadata->>'child_id'), '')::uuid;
    v_league := NULLIF(btrim(r.metadata->>'mini_league_id'), '')::uuid;
    v_player := NULLIF(btrim(r.metadata->>'player_id'), '')::uuid;

    IF v_child IS NOT NULL THEN
      UPDATE public.children SET parent_id = NEW.user_id
      WHERE id = v_child AND parent_id IS NULL;

      INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
      VALUES (v_child, NEW.user_id, 'parent', true)
      ON CONFLICT (child_id, guardian_id) DO NOTHING;

      IF v_league IS NOT NULL THEN
        INSERT INTO public.child_mini_league_assignments (child_id, mini_league_id, ability_rating)
        VALUES (v_child, v_league, 3)
        ON CONFLICT DO NOTHING;

        IF v_player IS NOT NULL THEN
          UPDATE public.mini_league_players SET parent_user_id = NEW.user_id
          WHERE id = v_player AND parent_user_id IS NULL;
        ELSE
          UPDATE public.mini_league_players SET parent_user_id = NEW.user_id
          WHERE child_id = v_child AND mini_league_id = v_league AND parent_user_id IS NULL;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- Provision both pending and already-accepted standard parent invites. For a
  -- pending invite this occurs before the acceptance update in this transaction.
  FOR a IN
    SELECT pi.id
    FROM public.pending_invites pi
    WHERE pi.status IN ('pending', 'accepted') AND (NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = NEW.user_id AND NULLIF(btrim(au.raw_user_meta_data->>'email_signup_invite_token'), '') IS NOT NULL) OR pi.invite_token = (SELECT au.raw_user_meta_data->>'email_signup_invite_token' FROM auth.users au WHERE au.id = NEW.user_id))
      AND pi.role::text IN ('parent', 'guardian')
      AND (
        pi.invited_user_id = NEW.user_id
        OR (v_email IS NOT NULL AND lower(btrim(pi.invited_email)) = v_email)
      )
      AND NOT COALESCE(pi.metadata ? 'mini_league_id', false)
      AND jsonb_typeof(pi.metadata->'children') = 'array'
      AND (
        (NEW.team_id IS NOT NULL AND pi.team_id = NEW.team_id)
        OR (NEW.team_id IS NULL AND NEW.club_id IS NOT NULL AND pi.club_id = NEW.club_id AND pi.team_id IS NULL)
      )
  LOOP
    PERFORM public.provision_invite_children(a.id, NEW.user_id);
  END LOOP;

  UPDATE public.pending_invites pi
  SET status = 'accepted',
      accepted_at = COALESCE(pi.accepted_at, now()),
      invited_user_id = COALESCE(pi.invited_user_id, NEW.user_id)
  WHERE pi.status = 'pending' AND (NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = NEW.user_id AND NULLIF(btrim(au.raw_user_meta_data->>'email_signup_invite_token'), '') IS NOT NULL) OR pi.invite_token = (SELECT au.raw_user_meta_data->>'email_signup_invite_token' FROM auth.users au WHERE au.id = NEW.user_id))
    AND (
      pi.invited_user_id = NEW.user_id
      OR (v_email IS NOT NULL AND lower(btrim(pi.invited_email)) = v_email)
    )
    AND (
      (NEW.team_id IS NOT NULL AND pi.team_id = NEW.team_id)
      OR (NEW.team_id IS NULL AND NEW.club_id IS NOT NULL AND pi.club_id = NEW.club_id AND pi.team_id IS NULL)
    );

  RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION public.claim_pending_invites_on_profile_create()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_email text;
  inv record;
  v_club uuid;
BEGIN
  SELECT lower(btrim(au.email)) INTO v_email
  FROM auth.users au
  WHERE au.id = NEW.id;

  -- Include already-accepted invites for this same profile so a prior role or
  -- invite trigger can never starve child provisioning.
  FOR inv IN
    SELECT pi.*
    FROM public.pending_invites pi
    WHERE pi.status IN ('pending', 'accepted') AND (NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = NEW.id AND NULLIF(btrim(au.raw_user_meta_data->>'email_signup_invite_token'), '') IS NOT NULL) OR pi.invite_token = (SELECT au.raw_user_meta_data->>'email_signup_invite_token' FROM auth.users au WHERE au.id = NEW.id))
      AND pi.role::text IN ('parent', 'guardian')
      AND NOT COALESCE(pi.metadata ? 'mini_league_id', false)
      AND COALESCE(pi.metadata->>'kind', '') NOT IN ('mini_league_parent_join_link', 'league_admin_join_link')
      AND jsonb_typeof(pi.metadata->'children') = 'array'
      AND jsonb_array_length(pi.metadata->'children') > 0
      AND (
        pi.invited_user_id = NEW.id
        OR (v_email IS NOT NULL AND lower(btrim(pi.invited_email)) = v_email)
      )
  LOOP
    BEGIN
      v_club := inv.club_id;
      IF inv.team_id IS NOT NULL THEN
        SELECT t.club_id INTO v_club FROM public.teams t WHERE t.id = inv.team_id;
      END IF;

      IF v_club IS NULL AND inv.team_id IS NULL THEN
        RAISE EXCEPTION 'invite_scope_missing' USING ERRCODE = '22023';
      END IF;

      PERFORM public.provision_invite_children(inv.id, NEW.id);

      IF inv.team_id IS NOT NULL THEN
        INSERT INTO public.user_roles (user_id, role, team_id, club_id)
        SELECT NEW.id, 'parent'::app_role, inv.team_id, v_club
        WHERE NOT EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = NEW.id AND ur.role::text = 'parent' AND ur.team_id = inv.team_id
        );
      ELSE
        INSERT INTO public.user_roles (user_id, role, team_id, club_id)
        SELECT NEW.id, 'parent'::app_role, NULL, v_club
        WHERE NOT EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = NEW.id AND ur.role::text = 'parent'
            AND ur.team_id IS NULL AND ur.club_id = v_club
        );
      END IF;

      UPDATE public.pending_invites pi
      SET status = 'accepted',
          accepted_at = COALESCE(pi.accepted_at, now()),
          invited_user_id = COALESCE(pi.invited_user_id, NEW.id)
      WHERE pi.id = inv.id
        AND pi.status = 'pending';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'claim_pending_invites_on_profile_create: invite % not provisioned (%)', inv.id::text, SQLERRM;
    END;
  END LOOP;

  RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION public.email_signup_invite_allowed(_token text, _email text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE config jsonb; allowed jsonb;
BEGIN
 SELECT value INTO config FROM public.app_settings WHERE key = 'backend_routing_config';
 allowed := config->'emailAuthClubs';
 IF allowed IS NULL THEN RETURN NULL; END IF;
 IF jsonb_typeof(allowed) <> 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(allowed) = 0 THEN RETURN NULL; END IF;
 IF nullif(btrim(_token), '') IS NULL OR nullif(btrim(_email), '') IS NULL THEN RETURN false; END IF;
 RETURN EXISTS (
   SELECT 1 FROM public.pending_invites pi LEFT JOIN public.teams t ON t.id = pi.team_id
   WHERE pi.invite_token = _token AND pi.status = 'pending'
     AND pi.invited_user_id IS NULL
     AND (NULLIF(btrim(pi.invited_email), '') IS NULL OR lower(btrim(pi.invited_email)) = lower(btrim(_email)))
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(allowed) a WHERE lower(a->>'id') = COALESCE(pi.club_id,t.club_id)::text)
 ) OR EXISTS (
   SELECT 1 FROM public.team_invites ti JOIN public.teams t ON t.id = ti.team_id
   WHERE ti.token = _token AND (ti.expires_at IS NULL OR ti.expires_at > now())
     AND (ti.max_uses IS NULL OR ti.uses_count < ti.max_uses)
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(allowed) a WHERE lower(a->>'id') = t.club_id::text)
 ) OR EXISTS (
   SELECT 1 FROM public.club_invites ci WHERE ci.token = _token
     AND (ci.expires_at IS NULL OR ci.expires_at > now())
     AND (ci.max_uses IS NULL OR ci.uses_count < ci.max_uses)
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(allowed) a WHERE lower(a->>'id') = ci.club_id::text)
 );
END;
$function$

CREATE OR REPLACE FUNCTION public.enforce_email_signup_invite()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF COALESCE(NEW.raw_app_meta_data->>'provider','email') = 'email'
    AND public.email_signup_invite_allowed(NEW.raw_user_meta_data->>'email_signup_invite_token', NEW.email) IS FALSE THEN
   RAISE EXCEPTION 'Email signup requires a valid invitation for an email-enabled club.' USING ERRCODE = 'P0001';
 END IF;
 RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION public.provision_invite_children(_invite_id uuid, _guardian_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _invite public.pending_invites%ROWTYPE;
  _caller uuid := auth.uid();
  _caller_role text := COALESCE(auth.role(), '');
  _guardian_email text;
  _entry jsonb;
  _name text;
  _year_of_birth integer;
  _referenced_child_id uuid;
  _child_id uuid;
  _team_name_match uuid;
  _candidate_count integer;
  _rows integer;
  _children_created integer := 0;
  _guardian_links_created integer := 0;
  _team_assignments_created integer := 0;
  _child_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF _invite_id IS NULL OR _guardian_id IS NULL THEN
    RAISE EXCEPTION 'invite_and_guardian_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _invite
  FROM public.pending_invites
  WHERE id = _invite_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF _invite.role::text NOT IN ('parent', 'guardian') THEN
    RAISE EXCEPTION 'not_a_child_parent_invite' USING ERRCODE = '22023';
  END IF;

  IF _invite.team_id IS NULL THEN
    RAISE EXCEPTION 'invite_team_required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _guardian_id) THEN
    RAISE EXCEPTION 'guardian_profile_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Browser callers may only provision themselves. A null auth.uid() is only
  -- reachable through trusted owner/service execution because PUBLIC and anon
  -- execution are revoked below.
  IF _caller IS NOT NULL AND _caller <> _guardian_id THEN
    RAISE EXCEPTION 'invite_not_for_this_user' USING ERRCODE = '42501';
  END IF;

  IF _caller IS NULL AND _caller_role NOT IN ('', 'service_role') THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT lower(btrim(u.email)) INTO _guardian_email
  FROM auth.users u
  WHERE u.id = _guardian_id;

  IF NOT (
    _invite.invited_user_id = _guardian_id
    OR (
      _invite.invited_user_id IS NULL
      AND _invite.invited_email IS NOT NULL
      AND _guardian_email IS NOT NULL
      AND lower(btrim(_invite.invited_email)) = _guardian_email
    )
  ) THEN
    RAISE EXCEPTION 'invite_not_for_this_user' USING ERRCODE = '42501';
  END IF;

  IF _invite.metadata IS NULL
     OR jsonb_typeof(_invite.metadata->'children') IS DISTINCT FROM 'array'
     OR jsonb_array_length(_invite.metadata->'children') = 0 THEN
    RETURN jsonb_build_object(
      'children_created', 0,
      'guardian_links_created', 0,
      'team_assignments_created', 0,
      'child_ids', '[]'::jsonb
    );
  END IF;

  FOR _entry IN SELECT value FROM jsonb_array_elements(_invite.metadata->'children')
  LOOP
    _name := '';
    _year_of_birth := NULL;
    _referenced_child_id := NULL;
    _child_id := NULL;
    _team_name_match := NULL;

    IF jsonb_typeof(_entry) = 'string' THEN
      _name := btrim(_entry #>> '{}');
    ELSIF jsonb_typeof(_entry) = 'object' THEN
      _name := btrim(COALESCE(_entry->>'name', _entry->>'child_name', ''));

      BEGIN
        _year_of_birth := NULLIF(btrim(COALESCE(
          _entry->>'yearOfBirth',
          _entry->>'year_of_birth',
          CASE
            WHEN COALESCE(_entry->>'dateOfBirth', _entry->>'date_of_birth', '') <> ''
            THEN EXTRACT(YEAR FROM COALESCE(_entry->>'dateOfBirth', _entry->>'date_of_birth')::date)::text
            ELSE ''
          END
        )), '')::integer;
      EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
        _year_of_birth := NULL;
      END;

      BEGIN
        _referenced_child_id := NULLIF(btrim(COALESCE(
          _entry->>'existingChildId',
          _entry->>'existing_child_id',
          _entry->>'child_id',
          ''
        )), '')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'referenced_child_not_found' USING ERRCODE = 'P0002';
      END;
    ELSE
      CONTINUE;
    END IF;

    -- Malformed entries and blank names are ignored rather than consuming the
    -- whole invite or creating unusable rows.
    IF _name = '' THEN
      CONTINUE;
    END IF;

    IF _referenced_child_id IS NOT NULL THEN
      SELECT c.id INTO _child_id
      FROM public.children c
      WHERE c.id = _referenced_child_id
        AND lower(btrim(c.name)) = lower(_name)
        AND (
          c.parent_id = _guardian_id
          OR EXISTS (
            SELECT 1 FROM public.child_guardians cg
            WHERE cg.child_id = c.id AND cg.guardian_id = _guardian_id
          )
          OR EXISTS (
            SELECT 1 FROM public.child_team_assignments cta
            WHERE cta.child_id = c.id AND cta.team_id = _invite.team_id
          )
        );

      IF _child_id IS NULL THEN
        RAISE EXCEPTION 'referenced_child_out_of_scope' USING ERRCODE = '42501';
      END IF;
    END IF;

    -- Reuse only a child already belonging to this guardian. If more than one
    -- same-name child exists, only an existing assignment to this invite team
    -- is sufficiently specific; otherwise create a distinct child.
    IF _child_id IS NULL THEN
      SELECT count(*) INTO _candidate_count
      FROM public.children c
      WHERE lower(btrim(c.name)) = lower(_name)
        AND (_year_of_birth IS NULL OR c.year_of_birth IS NULL OR c.year_of_birth = _year_of_birth)
        AND (
          c.parent_id = _guardian_id
          OR EXISTS (
            SELECT 1 FROM public.child_guardians cg
            WHERE cg.child_id = c.id AND cg.guardian_id = _guardian_id
          )
        );

      SELECT c.id INTO _child_id
      FROM public.children c
      WHERE lower(btrim(c.name)) = lower(_name)
        AND (_year_of_birth IS NULL OR c.year_of_birth IS NULL OR c.year_of_birth = _year_of_birth)
        AND (
          c.parent_id = _guardian_id
          OR EXISTS (
            SELECT 1 FROM public.child_guardians cg
            WHERE cg.child_id = c.id AND cg.guardian_id = _guardian_id
          )
        )
        AND (
          _candidate_count = 1
          OR EXISTS (
            SELECT 1 FROM public.child_team_assignments cta
            WHERE cta.child_id = c.id AND cta.team_id = _invite.team_id
          )
        )
      ORDER BY
        EXISTS (
          SELECT 1 FROM public.child_team_assignments cta
          WHERE cta.child_id = c.id AND cta.team_id = _invite.team_id
        ) DESC,
        (c.parent_id = _guardian_id) DESC,
        c.created_at ASC
      LIMIT 1;
    END IF;

    -- Never let the legacy team-name dedupe trigger merge this guardian's new
    -- child into an unrelated same-name roster child.
    IF _child_id IS NULL THEN
      SELECT c.id INTO _team_name_match
      FROM public.children c
      JOIN public.child_team_assignments cta ON cta.child_id = c.id
      WHERE cta.team_id = _invite.team_id
        AND lower(btrim(c.name)) = lower(_name)
      ORDER BY c.created_at ASC
      LIMIT 1;

      IF _team_name_match IS NOT NULL THEN
        IF EXISTS (
          SELECT 1 FROM public.children c
          WHERE c.id = _team_name_match AND c.parent_id = _guardian_id
        ) OR EXISTS (
          SELECT 1 FROM public.child_guardians cg
          WHERE cg.child_id = _team_name_match AND cg.guardian_id = _guardian_id
        ) THEN
          _child_id := _team_name_match;
        ELSIF EXISTS (
          SELECT 1 FROM public.children c
          WHERE c.id = _team_name_match AND c.parent_id IS NULL
        ) AND NOT EXISTS (
          SELECT 1 FROM public.child_guardians cg
          WHERE cg.child_id = _team_name_match
        ) THEN
          _child_id := _team_name_match;
        ELSE
          -- Keep unrelated same-name children distinct; the assignment trigger
          -- now merges only when the guardian relationship proves identity.
          _team_name_match := NULL;
        END IF;
      END IF;
    END IF;

    IF _child_id IS NULL THEN
      INSERT INTO public.children (parent_id, name, year_of_birth)
      VALUES (_guardian_id, _name, _year_of_birth)
      RETURNING id INTO _child_id;
      _children_created := _children_created + 1;
    ELSE
      UPDATE public.children c
      SET parent_id = COALESCE(c.parent_id, _guardian_id),
          year_of_birth = COALESCE(c.year_of_birth, _year_of_birth)
      WHERE c.id = _child_id
        AND (c.parent_id IS NULL OR c.parent_id = _guardian_id);
    END IF;

    INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
    VALUES (_child_id, _guardian_id, 'parent', true)
    ON CONFLICT (child_id, guardian_id) DO NOTHING;
    GET DIAGNOSTICS _rows = ROW_COUNT;
    _guardian_links_created := _guardian_links_created + _rows;

    INSERT INTO public.child_team_assignments (child_id, team_id)
    VALUES (_child_id, _invite.team_id)
    ON CONFLICT (child_id, team_id) DO NOTHING;
    GET DIAGNOSTICS _rows = ROW_COUNT;
    _team_assignments_created := _team_assignments_created + _rows;

    IF NOT EXISTS (
      SELECT 1 FROM public.child_guardians cg
      WHERE cg.child_id = _child_id AND cg.guardian_id = _guardian_id
    ) OR NOT EXISTS (
      SELECT 1 FROM public.child_team_assignments cta
      WHERE cta.child_id = _child_id AND cta.team_id = _invite.team_id
    ) THEN
      RAISE EXCEPTION 'child_provisioning_incomplete' USING ERRCODE = 'P0002';
    END IF;

    IF NOT (_child_id = ANY(_child_ids)) THEN
      _child_ids := array_append(_child_ids, _child_id);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'children_created', _children_created,
    'guardian_links_created', _guardian_links_created,
    'team_assignments_created', _team_assignments_created,
    'child_ids', to_jsonb(_child_ids)
  );
END;
$function$
