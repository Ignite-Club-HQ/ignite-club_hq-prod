-- LOCAL SECURITY-TEST PARITY ONLY. Mirrors the production parent-invite
-- trigger/security migration; contains no hosted project identifiers or data.
-- =========================================================================
-- Parent-invite provisioning: secure + version-controlled + atomic
-- =========================================================================

-- 1. Private internal provisioning function.
--    Accepts an explicit user id. NEVER callable by clients.
CREATE OR REPLACE FUNCTION public._provision_invite_children_internal(
  p_invite_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv record;
  entry jsonb;
  v_name text;
  v_yob int;
  v_dob text;
  v_existing_id uuid;
  v_child uuid;
  v_ids uuid[] := '{}';
  v_club uuid;
  v_owned boolean;
  v_in_scope boolean;
  v_unclaimed boolean;
BEGIN
  IF p_invite_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'invite_reference_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO inv FROM public.pending_invites WHERE id = p_invite_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Mini-league invites and non-parent invites have their own paths: no-op.
  IF inv.metadata ? 'mini_league_id'
     OR inv.role::text NOT IN ('parent','guardian')
     OR inv.metadata IS NULL
     OR jsonb_typeof(inv.metadata->'children') <> 'array' THEN
    RETURN jsonb_build_object('child_ids', '[]'::jsonb);
  END IF;

  v_club := inv.club_id;
  IF inv.team_id IS NOT NULL THEN
    SELECT t.club_id INTO v_club FROM public.teams t WHERE t.id = inv.team_id;
    IF v_club IS NULL THEN
      RAISE EXCEPTION 'invite_team_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF inv.club_id IS NOT NULL AND inv.club_id <> v_club THEN
      RAISE EXCEPTION 'invite_scope_mismatch' USING ERRCODE = '22023';
    END IF;
  END IF;

  FOR entry IN SELECT * FROM jsonb_array_elements(inv.metadata->'children')
  LOOP
    v_existing_id := NULL;
    v_yob := NULL;

    IF jsonb_typeof(entry) = 'string' THEN
      v_name := btrim(entry #>> '{}');
    ELSE
      v_name := btrim(COALESCE(entry->>'name', entry->>'child_name', ''));
      BEGIN
        v_yob := NULLIF(btrim(COALESCE(entry->>'yearOfBirth', entry->>'year_of_birth', '')), '')::int;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'invalid_child_year_of_birth' USING ERRCODE = '22023';
      END;
      v_dob := NULLIF(btrim(COALESCE(entry->>'date_of_birth', entry->>'dateOfBirth', '')), '');
      IF v_yob IS NULL AND v_dob IS NOT NULL THEN
        BEGIN
          v_yob := EXTRACT(YEAR FROM v_dob::date)::int;
        EXCEPTION WHEN others THEN
          v_yob := NULL;
        END;
      END IF;
      BEGIN
        v_existing_id := NULLIF(btrim(COALESCE(entry->>'existingChildId', entry->>'existing_child_id', '')), '')::uuid;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'referenced_child_not_found' USING ERRCODE = 'P0002';
      END;
    END IF;

    IF v_name IS NULL OR v_name = '' THEN
      RAISE EXCEPTION 'invalid_child_name' USING ERRCODE = '22023';
    END IF;

    v_child := NULL;

    IF v_existing_id IS NOT NULL THEN
      -- The reference must exist. Never silently create a replacement.
      IF NOT EXISTS (SELECT 1 FROM public.children WHERE id = v_existing_id) THEN
        RAISE EXCEPTION 'referenced_child_not_found' USING ERRCODE = 'P0002';
      END IF;

      -- Already owned / guardian-linked by this recipient?
      SELECT EXISTS (
        SELECT 1 FROM public.children c
        WHERE c.id = v_existing_id AND c.parent_id = p_user_id
      ) OR EXISTS (
        SELECT 1 FROM public.child_guardians cg
        WHERE cg.child_id = v_existing_id AND cg.guardian_id = p_user_id
      ) INTO v_owned;

      IF NOT v_owned THEN
        -- Otherwise it must be an unclaimed roster child inside the invite scope.
        SELECT NOT EXISTS (
          SELECT 1 FROM public.children c
          WHERE c.id = v_existing_id AND c.parent_id IS NOT NULL
        ) AND NOT EXISTS (
          SELECT 1 FROM public.child_guardians cg WHERE cg.child_id = v_existing_id
        ) INTO v_unclaimed;

        SELECT EXISTS (
          SELECT 1
          FROM public.child_team_assignments cta
          JOIN public.teams t ON t.id = cta.team_id
          WHERE cta.child_id = v_existing_id
            AND (
              (inv.team_id IS NOT NULL AND cta.team_id = inv.team_id)
              OR (v_club IS NOT NULL AND t.club_id = v_club)
            )
        ) OR EXISTS (
          SELECT 1
          FROM public.child_mini_league_assignments cml
          JOIN public.mini_leagues ml ON ml.id = cml.mini_league_id
          WHERE cml.child_id = v_existing_id
            AND v_club IS NOT NULL
            AND ml.club_id = v_club
        ) INTO v_in_scope;

        IF NOT (COALESCE(v_unclaimed,false) AND COALESCE(v_in_scope,false)) THEN
          RAISE EXCEPTION 'referenced_child_out_of_scope' USING ERRCODE = '42501';
        END IF;
      END IF;

      v_child := v_existing_id;
    END IF;

    -- Match an existing child of this guardian by trimmed, case-insensitive name.
    IF v_child IS NULL THEN
      SELECT c.id INTO v_child
      FROM public.children c
      WHERE lower(btrim(c.name)) = lower(v_name)
        AND (
          c.parent_id = p_user_id
          OR EXISTS (
            SELECT 1 FROM public.child_guardians cg
            WHERE cg.child_id = c.id AND cg.guardian_id = p_user_id
          )
        )
      ORDER BY (c.parent_id = p_user_id) DESC, c.created_at ASC
      LIMIT 1;
    END IF;

    IF v_child IS NULL THEN
      INSERT INTO public.children (parent_id, name, year_of_birth)
      VALUES (p_user_id, v_name, v_yob)
      RETURNING id INTO v_child;
    ELSE
      UPDATE public.children
         SET parent_id = COALESCE(parent_id, p_user_id),
             year_of_birth = COALESCE(year_of_birth, v_yob)
       WHERE id = v_child;
    END IF;

    IF v_child IS NULL THEN
      RAISE EXCEPTION 'child_create_failed' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
    SELECT v_child, p_user_id, 'parent', true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.child_guardians
      WHERE child_id = v_child AND guardian_id = p_user_id
    );

    IF NOT EXISTS (
      SELECT 1 FROM public.child_guardians WHERE child_id = v_child AND guardian_id = p_user_id
    ) AND NOT EXISTS (
      SELECT 1 FROM public.children WHERE id = v_child AND parent_id = p_user_id
    ) THEN
      RAISE EXCEPTION 'child_guardian_link_failed' USING ERRCODE = 'P0002';
    END IF;

    IF inv.team_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.child_team_assignments
        WHERE child_id = v_child AND team_id = inv.team_id
      ) THEN
        BEGIN
          INSERT INTO public.child_team_assignments (child_id, team_id)
          VALUES (v_child, inv.team_id);
        EXCEPTION WHEN unique_violation THEN
          NULL;
        END;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.child_team_assignments
        WHERE child_id = v_child AND team_id = inv.team_id
      ) THEN
        -- A dedupe trigger may have merged this child into the roster child.
        SELECT cta.child_id INTO v_child
        FROM public.child_team_assignments cta
        JOIN public.children c ON c.id = cta.child_id
        WHERE cta.team_id = inv.team_id
          AND lower(btrim(c.name)) = lower(v_name)
        LIMIT 1;

        IF v_child IS NULL THEN
          RAISE EXCEPTION 'child_team_assignment_failed' USING ERRCODE = 'P0002';
        END IF;

        INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
        SELECT v_child, p_user_id, 'parent', false
        WHERE NOT EXISTS (
          SELECT 1 FROM public.child_guardians
          WHERE child_id = v_child AND guardian_id = p_user_id
        );
      END IF;
    END IF;

    IF NOT (v_child = ANY(v_ids)) THEN
      v_ids := array_append(v_ids, v_child);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('child_ids', to_jsonb(v_ids));
END;
$$;

REVOKE ALL ON FUNCTION public._provision_invite_children_internal(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._provision_invite_children_internal(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public._provision_invite_children_internal(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._provision_invite_children_internal(uuid, uuid) TO service_role;

-- 2. Authenticated wrapper: derives the user strictly from auth.uid().
DROP FUNCTION IF EXISTS public.provision_invite_children(uuid, uuid);

CREATE OR REPLACE FUNCTION public.provision_invite_children(p_invite_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _email text;
  _inv record;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_invite_id IS NULL THEN
    RAISE EXCEPTION 'invite_reference_required' USING ERRCODE = '22023';
  END IF;

  SELECT id, invited_user_id, invited_email
    INTO _inv
  FROM public.pending_invites
  WHERE id = p_invite_id;

  IF NOT FOUND THEN
    -- Do not disclose whether the invite exists for someone else.
    RAISE EXCEPTION 'invite_not_for_this_user' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO _email FROM auth.users WHERE id = _uid;

  IF NOT (
    _inv.invited_user_id = _uid
    OR (
      _inv.invited_user_id IS NULL
      AND _inv.invited_email IS NOT NULL
      AND _email IS NOT NULL
      AND lower(btrim(_inv.invited_email)) = lower(btrim(_email))
    )
  ) THEN
    RAISE EXCEPTION 'invite_not_for_this_user' USING ERRCODE = '42501';
  END IF;

  RETURN public._provision_invite_children_internal(p_invite_id, _uid);
END;
$$;

REVOKE ALL ON FUNCTION public.provision_invite_children(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provision_invite_children(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.provision_invite_children(uuid) TO authenticated, service_role;

-- 3. Role trigger now uses the private internal function.
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
  SELECT lower(au.email) INTO v_email
  FROM auth.users au
  WHERE au.id = NEW.user_id;

  FOR r IN
    SELECT pi.*
    FROM public.pending_invites pi
    WHERE pi.status = 'pending'
      AND pi.role = 'parent'
      AND (
        pi.invited_user_id = NEW.user_id
        OR (v_email IS NOT NULL AND lower(pi.invited_email) = v_email)
      )
      AND (
        (NEW.team_id IS NOT NULL AND pi.team_id = NEW.team_id)
        OR (NEW.team_id IS NULL AND NEW.club_id IS NOT NULL AND pi.club_id = NEW.club_id AND pi.team_id IS NULL)
      )
      AND pi.metadata ? 'mini_league_id'
      AND pi.metadata ? 'child_id'
  LOOP
    v_child  := NULLIF(r.metadata->>'child_id','')::uuid;
    v_league := NULLIF(r.metadata->>'mini_league_id','')::uuid;
    v_player := NULLIF(r.metadata->>'player_id','')::uuid;

    IF v_child IS NOT NULL THEN
      UPDATE public.children
         SET parent_id = NEW.user_id
       WHERE id = v_child
         AND parent_id IS NULL;

      INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
      VALUES (v_child, NEW.user_id, 'parent', true)
      ON CONFLICT DO NOTHING;

      IF v_league IS NOT NULL THEN
        INSERT INTO public.child_mini_league_assignments (child_id, mini_league_id, ability_rating)
        VALUES (v_child, v_league, 3)
        ON CONFLICT DO NOTHING;

        IF v_player IS NOT NULL THEN
          UPDATE public.mini_league_players
             SET parent_user_id = NEW.user_id
           WHERE id = v_player AND parent_user_id IS NULL;
        ELSE
          UPDATE public.mini_league_players
             SET parent_user_id = NEW.user_id
           WHERE child_id = v_child
             AND mini_league_id = v_league
             AND parent_user_id IS NULL;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- Provision invited children BEFORE the invite is marked accepted, so a
  -- child-carrying parent invite is never consumed without its children.
  FOR a IN
    SELECT pi.id
    FROM public.pending_invites pi
    WHERE pi.status = 'pending'
      AND pi.role::text IN ('parent','guardian')
      AND (
        pi.invited_user_id = NEW.user_id
        OR (v_email IS NOT NULL AND lower(pi.invited_email) = v_email)
      )
      AND NOT (pi.metadata ? 'mini_league_id')
      AND jsonb_typeof(pi.metadata->'children') = 'array'
      AND (
        (NEW.team_id IS NOT NULL AND pi.team_id = NEW.team_id)
        OR (NEW.team_id IS NULL AND NEW.club_id IS NOT NULL AND pi.club_id = NEW.club_id AND pi.team_id IS NULL)
      )
  LOOP
    PERFORM public._provision_invite_children_internal(a.id, NEW.user_id);
  END LOOP;

  UPDATE public.pending_invites pi
  SET status = 'accepted',
      accepted_at = COALESCE(pi.accepted_at, now()),
      invited_user_id = COALESCE(pi.invited_user_id, NEW.user_id)
  WHERE pi.status = 'pending'
    AND (
      pi.invited_user_id = NEW.user_id
      OR (v_email IS NOT NULL AND lower(pi.invited_email) = v_email)
    )
    AND (
      (NEW.team_id IS NOT NULL AND pi.team_id = NEW.team_id)
      OR (NEW.team_id IS NULL AND NEW.club_id IS NOT NULL AND pi.club_id = NEW.club_id AND pi.team_id IS NULL)
    );

  -- Safety net for invites already accepted by another path.
  FOR a IN
    SELECT pi.id
    FROM public.pending_invites pi
    WHERE pi.status = 'accepted'
      AND pi.role::text IN ('parent','guardian')
      AND pi.invited_user_id = NEW.user_id
      AND NOT (pi.metadata ? 'mini_league_id')
      AND jsonb_typeof(pi.metadata->'children') = 'array'
      AND (
        (NEW.team_id IS NOT NULL AND pi.team_id = NEW.team_id)
        OR (NEW.team_id IS NULL AND NEW.club_id IS NOT NULL AND pi.club_id = NEW.club_id AND pi.team_id IS NULL)
      )
  LOOP
    PERFORM public._provision_invite_children_internal(a.id, NEW.user_id);
  END LOOP;

  RETURN NEW;
END;
$function$;

-- 4. Version-controlled profile-creation claim: provision children + parent
--    role, then accept, all inside a per-invite savepoint so a failure leaves
--    the invite pending with no partial rows.
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
  SELECT lower(btrim(au.email)) INTO v_email FROM auth.users au WHERE au.id = NEW.id;

  FOR inv IN
    SELECT pi.*
    FROM public.pending_invites pi
    WHERE pi.status = 'pending'
      AND pi.role::text IN ('parent','guardian')
      AND NOT (pi.metadata ? 'mini_league_id')
      AND COALESCE(pi.metadata->>'kind','') NOT IN ('mini_league_parent_join_link','league_admin_join_link')
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

      PERFORM public._provision_invite_children_internal(inv.id, NEW.id);

      IF inv.team_id IS NOT NULL THEN
        INSERT INTO public.user_roles (user_id, role, team_id, club_id)
        SELECT NEW.id, 'parent'::app_role, inv.team_id, v_club
        WHERE NOT EXISTS (
          SELECT 1 FROM public.user_roles
          WHERE user_id = NEW.id AND role = 'parent'::app_role AND team_id = inv.team_id
        );
      ELSE
        INSERT INTO public.user_roles (user_id, role, team_id, club_id)
        SELECT NEW.id, 'parent'::app_role, NULL, v_club
        WHERE NOT EXISTS (
          SELECT 1 FROM public.user_roles
          WHERE user_id = NEW.id AND role = 'parent'::app_role
            AND team_id IS NULL AND club_id = v_club
        );
      END IF;

      UPDATE public.pending_invites
         SET status = 'accepted',
             accepted_at = COALESCE(accepted_at, now()),
             invited_user_id = COALESCE(invited_user_id, NEW.id)
       WHERE id = inv.id
         AND status = 'pending';
    EXCEPTION WHEN OTHERS THEN
      -- Roll back this invite only; it stays pending for a retry.
      RAISE WARNING 'claim_pending_invites_on_profile_create: invite % not provisioned (%)', inv.id, SQLERRM;
    END;
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS claim_pending_invites_on_profile_create_trigger ON public.profiles;
CREATE TRIGGER claim_pending_invites_on_profile_create_trigger
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.claim_pending_invites_on_profile_create();
