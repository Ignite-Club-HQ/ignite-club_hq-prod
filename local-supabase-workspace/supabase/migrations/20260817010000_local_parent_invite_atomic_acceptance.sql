-- LOCAL SECURITY-TEST PARITY ONLY. NOT A DEPLOYMENT MIGRATION.
-- Keep the synthetic schema compatible with the exact production RPC below.
ALTER TABLE public.pending_invites
  ADD COLUMN IF NOT EXISTS invited_email text;

CREATE TABLE IF NOT EXISTS public.child_mini_league_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  mini_league_id uuid NOT NULL REFERENCES public.mini_leagues(id) ON DELETE CASCADE,
  ability_rating integer NOT NULL DEFAULT 3,
  UNIQUE (child_id, mini_league_id)
);

GRANT ALL ON public.child_mini_league_assignments TO service_role;

CREATE OR REPLACE FUNCTION public.accept_parent_team_invite(
  _invite_id uuid DEFAULT NULL,
  _invite_token text DEFAULT NULL
)
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
    IF _invite.invited_user_id = _uid THEN
      RETURN jsonb_build_object('success', true, 'already_accepted', true, 'invite_id', _invite.id);
    END IF;
    RAISE EXCEPTION 'invite_not_pending' USING ERRCODE = '22023';
  END IF;

  -- Ownership: never trust a client-supplied user id.
  IF NOT (
    _invite.invited_user_id = _uid
    OR (
      _invite.invited_user_id IS NULL
      AND _invite.invited_email IS NOT NULL
      AND _user_email IS NOT NULL
      AND lower(btrim(_invite.invited_email)) = lower(btrim(_user_email))
    )
  ) THEN
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
$function$;

REVOKE ALL ON FUNCTION public.accept_parent_team_invite(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_parent_team_invite(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_parent_team_invite(uuid, text) TO authenticated;

-- Deterministic local-only fault injection. This proves that a failure after a
-- child insert rolls the child, role and invite acceptance back together.
CREATE OR REPLACE FUNCTION local_test.force_parent_invite_assignment_failure()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, local_test
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.children c
    WHERE c.id = NEW.child_id
      AND c.name LIKE 'Synthetic Force Rollback%'
  ) THEN
    RAISE EXCEPTION 'synthetic_child_team_assignment_failure';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER local_force_parent_invite_assignment_failure
BEFORE INSERT ON public.child_team_assignments
FOR EACH ROW EXECUTE FUNCTION local_test.force_parent_invite_assignment_failure();
