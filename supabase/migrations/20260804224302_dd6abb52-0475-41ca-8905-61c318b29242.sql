CREATE OR REPLACE FUNCTION public.admin_link_child_to_parent(p_parent_user_id uuid, p_team_id uuid, p_club_id uuid, p_child_name text, p_existing_child_id uuid DEFAULT NULL, p_pending_invite_ids uuid[] DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_child_id uuid;
  v_caller_id uuid := auth.uid();
  v_is_authorized boolean := false;
  v_current_parent uuid;
  v_dup_id uuid;
  v_dup_refs integer;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = v_caller_id
    AND (
      ur.role = 'app_admin'
      OR (ur.role = 'club_admin' AND ur.club_id = p_club_id)
      OR (ur.role = 'team_admin' AND ur.team_id = p_team_id)
    )
  ) INTO v_is_authorized;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  IF p_existing_child_id IS NOT NULL THEN
    v_child_id := p_existing_child_id;

    SELECT parent_id INTO v_current_parent
    FROM public.children
    WHERE id = v_child_id;

    IF v_current_parent IS NULL THEN
      UPDATE public.children
      SET parent_id = p_parent_user_id
      WHERE id = v_child_id;
    ELSIF v_current_parent <> p_parent_user_id THEN
      INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
      VALUES (v_child_id, p_parent_user_id, 'parent', false)
      ON CONFLICT DO NOTHING;
    END IF;

    SELECT c.id INTO v_dup_id
    FROM public.children c
    WHERE c.id <> v_child_id
      AND c.parent_id = p_parent_user_id
      AND lower(btrim(c.name)) = lower(btrim(p_child_name))
    ORDER BY c.created_at
    LIMIT 1;

    IF v_dup_id IS NOT NULL THEN
      SELECT
        (SELECT count(*) FROM public.child_team_assignments WHERE child_id = v_dup_id)
        + (SELECT count(*) FROM public.child_mini_league_assignments WHERE child_id = v_dup_id)
      INTO v_dup_refs;

      IF v_dup_refs = 0 THEN
        INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
        SELECT v_child_id, g.guardian_id, g.relationship_type, false
        FROM public.child_guardians g
        WHERE g.child_id = v_dup_id
        ON CONFLICT DO NOTHING;

        DELETE FROM public.child_guardians WHERE child_id = v_dup_id;
        DELETE FROM public.children WHERE id = v_dup_id;
      END IF;
    END IF;

    INSERT INTO public.child_team_assignments (child_id, team_id)
    VALUES (v_child_id, p_team_id)
    ON CONFLICT DO NOTHING;
  ELSE
    SELECT c.id INTO v_child_id
    FROM public.children c
    WHERE lower(btrim(c.name)) = lower(btrim(p_child_name))
      AND (
        c.parent_id = p_parent_user_id
        OR EXISTS (
          SELECT 1 FROM public.child_guardians g
          WHERE g.child_id = c.id AND g.guardian_id = p_parent_user_id
        )
      )
    ORDER BY c.created_at
    LIMIT 1;

    IF v_child_id IS NULL THEN
      INSERT INTO public.children (name, parent_id)
      VALUES (btrim(p_child_name), p_parent_user_id)
      RETURNING id INTO v_child_id;
    END IF;

    INSERT INTO public.child_team_assignments (child_id, team_id)
    VALUES (v_child_id, p_team_id)
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.user_roles (user_id, team_id, club_id, role)
  VALUES (p_parent_user_id, p_team_id, p_club_id, 'parent')
  ON CONFLICT DO NOTHING;

  IF p_pending_invite_ids IS NOT NULL AND array_length(p_pending_invite_ids, 1) > 0 THEN
    UPDATE public.pending_invites
    SET status = 'accepted',
        accepted_at = now(),
        invited_user_id = p_parent_user_id
    WHERE id = ANY(p_pending_invite_ids)
      AND status = 'pending';
  END IF;
END;
$$;