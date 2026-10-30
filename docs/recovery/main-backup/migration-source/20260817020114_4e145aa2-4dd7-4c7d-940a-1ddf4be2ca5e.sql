CREATE OR REPLACE FUNCTION public.provision_invite_children(p_invite_id uuid, p_user_id uuid)
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
BEGIN
  IF p_invite_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('child_ids', '[]'::jsonb);
  END IF;

  SELECT * INTO inv FROM public.pending_invites WHERE id = p_invite_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('child_ids', '[]'::jsonb);
  END IF;

  -- Mini-league invites have their own provisioning path.
  IF inv.metadata ? 'mini_league_id' THEN
    RETURN jsonb_build_object('child_ids', '[]'::jsonb);
  END IF;

  IF inv.role::text NOT IN ('parent', 'guardian') THEN
    RETURN jsonb_build_object('child_ids', '[]'::jsonb);
  END IF;

  IF inv.metadata IS NULL OR jsonb_typeof(inv.metadata->'children') <> 'array' THEN
    RETURN jsonb_build_object('child_ids', '[]'::jsonb);
  END IF;

  FOR entry IN SELECT * FROM jsonb_array_elements(inv.metadata->'children')
  LOOP
    v_existing_id := NULL;
    v_yob := NULL;

    IF jsonb_typeof(entry) = 'string' THEN
      v_name := btrim(entry #>> '{}');
    ELSE
      v_name := btrim(COALESCE(entry->>'name', entry->>'child_name', ''));
      v_yob := NULLIF(btrim(COALESCE(entry->>'yearOfBirth', entry->>'year_of_birth', '')), '')::int;
      v_dob := NULLIF(btrim(COALESCE(entry->>'date_of_birth', entry->>'dateOfBirth', '')), '');
      IF v_yob IS NULL AND v_dob IS NOT NULL THEN
        BEGIN
          v_yob := EXTRACT(YEAR FROM v_dob::date)::int;
        EXCEPTION WHEN others THEN
          v_yob := NULL;
        END;
      END IF;
      v_existing_id := NULLIF(btrim(COALESCE(entry->>'existingChildId', entry->>'existing_child_id', '')), '')::uuid;
    END IF;

    IF v_name IS NULL OR v_name = '' THEN
      CONTINUE;
    END IF;

    v_child := NULL;

    -- Reuse an explicitly referenced child when it is in scope for this guardian.
    IF v_existing_id IS NOT NULL THEN
      SELECT c.id INTO v_child
      FROM public.children c
      WHERE c.id = v_existing_id
        AND (
          c.parent_id IS NULL
          OR c.parent_id = p_user_id
          OR EXISTS (
            SELECT 1 FROM public.child_guardians cg
            WHERE cg.child_id = c.id AND cg.guardian_id = p_user_id
          )
        );
    END IF;

    -- Otherwise match an existing child of this guardian by trimmed, case-insensitive name.
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
      ORDER BY c.created_at
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

    INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
    VALUES (v_child, p_user_id, 'parent', true)
    ON CONFLICT DO NOTHING;

    IF inv.team_id IS NOT NULL THEN
      INSERT INTO public.child_team_assignments (child_id, team_id)
      VALUES (v_child, inv.team_id)
      ON CONFLICT DO NOTHING;
    END IF;

    v_ids := array_append(v_ids, v_child);
  END LOOP;

  RETURN jsonb_build_object('child_ids', to_jsonb(v_ids));
END;
$$;

GRANT EXECUTE ON FUNCTION public.provision_invite_children(uuid, uuid) TO authenticated, service_role;

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

  -- Wire up any mini-league parent invites BEFORE marking accepted
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

  -- Original behaviour: mark matching invites accepted
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

  -- Safety net: materialise invited children for regular parent/guardian invites
  -- this trigger just accepted, so the frontend losing the race can't strand them.
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
    PERFORM public.provision_invite_children(a.id, NEW.user_id);
  END LOOP;

  RETURN NEW;
END;
$function$;