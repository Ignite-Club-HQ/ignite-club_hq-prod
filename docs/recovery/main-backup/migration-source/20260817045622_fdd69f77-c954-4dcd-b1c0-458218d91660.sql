CREATE OR REPLACE FUNCTION public.provision_invite_children(
  _invite_id uuid,
  _guardian_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
          OR (
            c.parent_id IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM public.child_guardians any_cg
              WHERE any_cg.child_id = c.id
            )
            AND EXISTS (
              SELECT 1 FROM public.child_team_assignments cta
              WHERE cta.child_id = c.id AND cta.team_id = _invite.team_id
            )
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
          RAISE EXCEPTION 'same_name_child_on_team_requires_explicit_reference' USING ERRCODE = '42501';
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
$$;

REVOKE ALL ON FUNCTION public.provision_invite_children(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provision_invite_children(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.provision_invite_children(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.auto_accept_pending_invites_on_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    WHERE pi.status = 'pending'
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
    WHERE pi.status IN ('pending', 'accepted')
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
  WHERE pi.status = 'pending'
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
$$;

CREATE OR REPLACE FUNCTION public.claim_pending_invites_on_profile_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    WHERE pi.status IN ('pending', 'accepted')
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
$$;

DROP TRIGGER IF EXISTS claim_pending_invites_on_profile_create_trigger ON public.profiles;
CREATE TRIGGER claim_pending_invites_on_profile_create_trigger
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.claim_pending_invites_on_profile_create();

-- One-time repair: invoke the same idempotent operation for every accepted,
-- owned parent invite with at least one child entry. Per-invite failures are
-- isolated and logged so one ambiguous legacy row cannot block all repairs.
DO $$
DECLARE
  repair record;
BEGIN
  FOR repair IN
    SELECT pi.id, pi.invited_user_id
    FROM public.pending_invites pi
    WHERE pi.status = 'accepted'
      AND pi.invited_user_id IS NOT NULL
      AND pi.role::text IN ('parent', 'guardian')
      AND pi.team_id IS NOT NULL
      AND NOT COALESCE(pi.metadata ? 'mini_league_id', false)
      AND jsonb_typeof(pi.metadata->'children') = 'array'
      AND jsonb_array_length(pi.metadata->'children') > 0
  LOOP
    BEGIN
      PERFORM public.provision_invite_children(repair.id, repair.invited_user_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'parent invite backfill skipped invite %: %', repair.id::text, SQLERRM;
    END;
  END LOOP;
END;
$$;