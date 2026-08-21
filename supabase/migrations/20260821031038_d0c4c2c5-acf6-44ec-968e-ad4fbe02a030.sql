-- Revert to ONE child record per human. Adding a child to a team in another
-- club reuses the parent's existing child row (merge), never creates a clone.
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

  -- Child with the same name already on this team -> link the parent as guardian
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

  -- The parent already has this child ANYWHERE (any club) -> reuse that record.
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
  ORDER BY (c.parent_id = p_parent_user_id) DESC, c.created_at
  LIMIT 1;

  IF v_existing_child_id IS NOT NULL THEN
    -- Backfill missing details and ensure the guardian link exists.
    UPDATE public.children
       SET year_of_birth = COALESCE(year_of_birth, p_year_of_birth)
     WHERE id = v_existing_child_id;

    INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
    VALUES (v_existing_child_id, p_parent_user_id, 'parent', false)
    ON CONFLICT DO NOTHING;

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

-- One record per child: a parent may never hold two rows with the same name,
-- regardless of which club the existing row is rostered in.
CREATE OR REPLACE FUNCTION public.prevent_duplicate_child_for_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_id uuid;
BEGIN
  IF NEW.name IS NULL OR btrim(NEW.name) = '' OR NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.id INTO existing_id
  FROM public.children c
  WHERE c.id <> NEW.id
    AND lower(btrim(c.name)) = lower(btrim(NEW.name))
    AND (
      c.parent_id = NEW.parent_id
      OR EXISTS (
        SELECT 1 FROM public.child_guardians g
        WHERE g.child_id = c.id AND g.guardian_id = NEW.parent_id
      )
    )
    AND (
      c.year_of_birth IS NULL
      OR NEW.year_of_birth IS NULL
      OR c.year_of_birth = NEW.year_of_birth
    )
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate_child_for_parent: % is already in your children list', btrim(NEW.name)
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;