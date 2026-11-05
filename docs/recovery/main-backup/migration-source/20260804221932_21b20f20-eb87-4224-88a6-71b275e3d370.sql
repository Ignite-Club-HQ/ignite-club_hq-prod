CREATE OR REPLACE FUNCTION public.create_child_for_parent_on_team(p_parent_user_id uuid, p_team_id uuid, p_name text, p_year_of_birth integer DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_child_id uuid;
  v_club_id uuid;
  v_existing_child_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Child name is required';
  END IF;

  SELECT t.club_id INTO v_club_id FROM public.teams t WHERE t.id = p_team_id;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'Team not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        (ur.team_id = p_team_id AND ur.role IN ('team_admin', 'coach', 'app_admin'))
        OR (ur.club_id = v_club_id AND ur.role IN ('club_admin', 'committee_member', 'app_admin'))
      )
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Child with the same name already on this team → link the parent as guardian
  SELECT c.id INTO v_existing_child_id
  FROM public.children c
  JOIN public.child_team_assignments cta ON cta.child_id = c.id
  WHERE cta.team_id = p_team_id
    AND lower(btrim(c.name)) = lower(btrim(p_name))
  LIMIT 1;

  IF v_existing_child_id IS NOT NULL THEN
    INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
    VALUES (v_existing_child_id, p_parent_user_id, 'parent', false)
    ON CONFLICT DO NOTHING;
    RETURN v_existing_child_id;
  END IF;

  -- The parent already has a child with this name elsewhere → reuse that record
  SELECT c.id INTO v_existing_child_id
  FROM public.children c
  WHERE lower(btrim(c.name)) = lower(btrim(p_name))
    AND (
      c.parent_id = p_parent_user_id
      OR EXISTS (
        SELECT 1 FROM public.child_guardians g
        WHERE g.child_id = c.id AND g.guardian_id = p_parent_user_id
      )
    )
    AND (
      c.year_of_birth IS NULL
      OR p_year_of_birth IS NULL
      OR c.year_of_birth = p_year_of_birth
    )
  ORDER BY c.created_at
  LIMIT 1;

  IF v_existing_child_id IS NOT NULL THEN
    INSERT INTO public.child_team_assignments (child_id, team_id)
    VALUES (v_existing_child_id, p_team_id)
    ON CONFLICT DO NOTHING;
    RETURN v_existing_child_id;
  END IF;

  INSERT INTO public.children (parent_id, name, year_of_birth)
  VALUES (p_parent_user_id, btrim(p_name), p_year_of_birth)
  RETURNING id INTO v_child_id;

  INSERT INTO public.child_team_assignments (child_id, team_id)
  VALUES (v_child_id, p_team_id)
  ON CONFLICT DO NOTHING;

  RETURN v_child_id;
END;
$$;

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
    UPDATE children SET parent_id = p_parent_user_id WHERE id = p_existing_child_id;
    v_child_id := p_existing_child_id;
  ELSE
    -- Reuse the parent's existing same-name child instead of creating a duplicate
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
      INSERT INTO children (name, parent_id)
      VALUES (btrim(p_child_name), p_parent_user_id)
      RETURNING id INTO v_child_id;
    END IF;

    INSERT INTO child_team_assignments (child_id, team_id)
    VALUES (v_child_id, p_team_id)
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO user_roles (user_id, team_id, club_id, role)
  VALUES (p_parent_user_id, p_team_id, p_club_id, 'parent')
  ON CONFLICT DO NOTHING;

  IF p_pending_invite_ids IS NOT NULL AND array_length(p_pending_invite_ids, 1) > 0 THEN
    UPDATE pending_invites
    SET status = 'accepted',
        accepted_at = now(),
        invited_user_id = p_parent_user_id
    WHERE id = ANY(p_pending_invite_ids)
      AND status = 'pending';
  END IF;
END;
$$;