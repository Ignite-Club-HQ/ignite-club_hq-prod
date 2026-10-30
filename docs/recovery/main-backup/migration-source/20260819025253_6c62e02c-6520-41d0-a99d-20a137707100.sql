CREATE OR REPLACE FUNCTION public.is_guardian_visible_in_club(_guardian_id uuid, _club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _guardian_id IS NOT NULL AND _club_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      LEFT JOIN public.teams t ON t.id = ur.team_id
      WHERE ur.user_id = _guardian_id
        AND (ur.club_id = _club_id OR t.club_id = _club_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.pending_invites pi
      LEFT JOIN public.teams t2 ON t2.id = pi.team_id
      WHERE pi.invited_user_id = _guardian_id
        AND pi.accepted_at IS NULL
        AND (pi.club_id = _club_id OR t2.club_id = _club_id)
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.club_scoped_child_guardians(p_child_ids uuid[], p_club_id uuid)
RETURNS TABLE(child_id uuid, guardian_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT g.child_id, g.guardian_id
  FROM public.child_guardians g
  WHERE g.child_id = ANY(p_child_ids)
    AND public.is_guardian_visible_in_club(g.guardian_id, p_club_id)
$$;

GRANT EXECUTE ON FUNCTION public.is_guardian_visible_in_club(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.club_scoped_child_guardians(uuid[], uuid) TO authenticated, service_role;

-- Only reuse an existing child record when that child is already visible in the
-- target club; otherwise create a club-local child so guardians from other
-- clubs are never silently attached.
CREATE OR REPLACE FUNCTION public.create_child_for_parent_on_team(p_parent_user_id uuid, p_team_id uuid, p_name text, p_year_of_birth integer DEFAULT NULL::integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- The parent already has a same-name child IN THIS CLUB → reuse that record
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
    AND EXISTS (
      SELECT 1
      FROM public.child_team_assignments cta2
      JOIN public.teams t2 ON t2.id = cta2.team_id
      WHERE cta2.child_id = c.id AND t2.club_id = v_club_id
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
$function$;