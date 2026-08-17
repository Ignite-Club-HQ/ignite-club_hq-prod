CREATE OR REPLACE FUNCTION public.prevent_duplicate_child_on_team()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_child_name text;
  v_existing_child_id uuid;
  v_new_parent_id uuid;
  v_safe_to_delete boolean;
  v_same_family boolean;
BEGIN
  SELECT c.name, c.parent_id
  INTO v_new_child_name, v_new_parent_id
  FROM public.children c
  WHERE c.id = NEW.child_id;

  SELECT c.id INTO v_existing_child_id
  FROM public.children c
  JOIN public.child_team_assignments cta ON cta.child_id = c.id
  WHERE cta.team_id = NEW.team_id
    AND lower(btrim(c.name)) = lower(btrim(v_new_child_name))
    AND c.id <> NEW.child_id
  ORDER BY c.created_at ASC
  LIMIT 1;

  IF v_existing_child_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- A same name is not identity. Merge only when the incoming parent already
  -- owns or is guardian-linked to the roster child. Otherwise keep both rows.
  SELECT v_new_parent_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.children c
      WHERE c.id = v_existing_child_id AND c.parent_id = v_new_parent_id
    )
    OR EXISTS (
      SELECT 1 FROM public.child_guardians cg
      WHERE cg.child_id = v_existing_child_id AND cg.guardian_id = v_new_parent_id
    )
  ) INTO v_same_family;

  IF NOT COALESCE(v_same_family, false) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
  SELECT v_existing_child_id, cg.guardian_id, COALESCE(cg.relationship_type, 'parent'), false
  FROM public.child_guardians cg
  WHERE cg.child_id = NEW.child_id
  ON CONFLICT (child_id, guardian_id) DO NOTHING;

  IF v_new_parent_id IS NOT NULL THEN
    INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
    VALUES (v_existing_child_id, v_new_parent_id, 'parent', false)
    ON CONFLICT (child_id, guardian_id) DO NOTHING;
  END IF;

  SELECT NOT EXISTS (SELECT 1 FROM public.child_team_assignments x WHERE x.child_id = NEW.child_id)
     AND NOT EXISTS (SELECT 1 FROM public.child_mini_league_assignments x WHERE x.child_id = NEW.child_id)
     AND NOT EXISTS (SELECT 1 FROM public.rsvps x WHERE x.child_id = NEW.child_id)
     AND NOT EXISTS (SELECT 1 FROM public.points_history x WHERE x.child_id = NEW.child_id)
     AND NOT EXISTS (SELECT 1 FROM public.child_club_points x WHERE x.child_id = NEW.child_id)
     AND NOT EXISTS (SELECT 1 FROM public.game_player_stats x WHERE x.child_id = NEW.child_id)
     AND NOT EXISTS (SELECT 1 FROM public.child_training_defaults x WHERE x.child_id = NEW.child_id)
  INTO v_safe_to_delete;

  IF v_safe_to_delete THEN
    DELETE FROM public.child_guardians WHERE child_id = NEW.child_id;
    DELETE FROM public.children WHERE id = NEW.child_id;
  END IF;

  RETURN NULL;
END;
$$;

-- Remove the obsolete refusal now that the dedupe trigger itself is family-safe.
DO $$
DECLARE
  v_definition text;
  v_updated text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'provision_invite_children'
    AND p.pronargs = 2;

  v_updated := replace(
    v_definition,
    E'        ELSE\n          RAISE EXCEPTION ''same_name_child_on_team_requires_explicit_reference'' USING ERRCODE = ''42501'';\n        END IF;',
    E'        ELSE\n          -- Keep unrelated same-name children distinct; the assignment trigger\n          -- now merges only when the guardian relationship proves identity.\n          _team_name_match := NULL;\n        END IF;'
  );

  IF v_updated IS NULL OR v_updated = v_definition THEN
    RAISE EXCEPTION 'provision_function_patch_not_applied';
  END IF;

  -- An explicit existingChildId is administrator-selected identity. It is
  -- accepted only when that exact row is already assigned to this exact team;
  -- a same-name lookup is never enough.
  v_updated := replace(
    v_updated,
    E'          OR (\n            c.parent_id IS NULL\n            AND NOT EXISTS (\n              SELECT 1 FROM public.child_guardians any_cg\n              WHERE any_cg.child_id = c.id\n            )\n            AND EXISTS (\n              SELECT 1 FROM public.child_team_assignments cta\n              WHERE cta.child_id = c.id AND cta.team_id = _invite.team_id\n            )\n          )',
    E'          OR EXISTS (\n            SELECT 1 FROM public.child_team_assignments cta\n            WHERE cta.child_id = c.id AND cta.team_id = _invite.team_id\n          )'
  );

  EXECUTE v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.provision_invite_children(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provision_invite_children(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.provision_invite_children(uuid, uuid) TO authenticated, service_role;

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

-- Security assertion: simulate a different authenticated user and require the
-- SECURITY DEFINER function to reject cross-user provisioning.
DO $$
DECLARE
  target record;
  other_user uuid;
  rejected boolean := false;
BEGIN
  SELECT pi.id, pi.invited_user_id
  INTO target
  FROM public.pending_invites pi
  WHERE pi.status = 'accepted'
    AND pi.invited_user_id IS NOT NULL
    AND pi.role::text IN ('parent', 'guardian')
    AND pi.team_id IS NOT NULL
    AND jsonb_typeof(pi.metadata->'children') = 'array'
  LIMIT 1;

  IF target.id IS NOT NULL THEN
    SELECT p.id INTO other_user
    FROM public.profiles p
    WHERE p.id <> target.invited_user_id
    LIMIT 1;

    IF other_user IS NOT NULL THEN
      PERFORM set_config('request.jwt.claim.sub', other_user::text, true);
      PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
      BEGIN
        PERFORM public.provision_invite_children(target.id, target.invited_user_id);
      EXCEPTION WHEN insufficient_privilege THEN
        rejected := true;
      END;
      PERFORM set_config('request.jwt.claim.sub', '', true);
      PERFORM set_config('request.jwt.claim.role', '', true);

      IF NOT rejected THEN
        RAISE EXCEPTION 'cross_user_provisioning_was_not_rejected';
      END IF;
    END IF;
  END IF;
END;
$$;