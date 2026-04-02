
-- Step 1: Update the RPC to check for existing children on the team before creating
CREATE OR REPLACE FUNCTION public.create_child_for_parent_on_team(
  p_parent_user_id uuid,
  p_name text,
  p_team_id uuid,
  p_year_of_birth integer DEFAULT NULL
)
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

  -- Check if a child with the same name already exists on this team
  SELECT c.id INTO v_existing_child_id
  FROM public.children c
  JOIN public.child_team_assignments cta ON cta.child_id = c.id
  WHERE cta.team_id = p_team_id
    AND lower(btrim(c.name)) = lower(btrim(p_name))
  LIMIT 1;

  IF v_existing_child_id IS NOT NULL THEN
    -- Child already exists on this team — link the new parent as guardian
    INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
    VALUES (v_existing_child_id, p_parent_user_id, 'parent', false)
    ON CONFLICT DO NOTHING;
    
    -- Also set parent_id if they don't own a child record yet
    -- (keep existing parent_id, just add guardian link)
    RETURN v_existing_child_id;
  END IF;

  -- No existing child found — create new one
  INSERT INTO public.children (parent_id, name, year_of_birth)
  VALUES (p_parent_user_id, btrim(p_name), p_year_of_birth)
  RETURNING id INTO v_child_id;

  INSERT INTO public.child_team_assignments (child_id, team_id)
  VALUES (v_child_id, p_team_id)
  ON CONFLICT DO NOTHING;

  RETURN v_child_id;
END;
$$;

-- Step 2: Add unique constraint on child_team_assignments
CREATE UNIQUE INDEX IF NOT EXISTS child_team_assignments_unique 
  ON public.child_team_assignments (child_id, team_id);

-- Step 3: Merge existing duplicate children
-- For each pair, keep the first (canonical), reparent data from the second (duplicate)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT 
      (array_agg(c.id ORDER BY c.created_at))[1] as keep_id,
      (array_agg(c.id ORDER BY c.created_at))[2] as dup_id,
      (array_agg(c.parent_id ORDER BY c.created_at))[1] as keep_parent,
      (array_agg(c.parent_id ORDER BY c.created_at))[2] as dup_parent
    FROM children c
    JOIN child_team_assignments cta ON cta.child_id = c.id
    GROUP BY lower(trim(c.name)), cta.team_id
    HAVING count(*) > 1
  LOOP
    -- Link duplicate's parent as guardian of canonical child
    INSERT INTO child_guardians (child_id, guardian_id, relationship_type, is_primary)
    VALUES (r.keep_id, r.dup_parent, 'parent', false)
    ON CONFLICT DO NOTHING;
    
    -- Also link canonical's parent as guardian if different
    IF r.keep_parent != r.dup_parent THEN
      INSERT INTO child_guardians (child_id, guardian_id, relationship_type, is_primary)
      VALUES (r.keep_id, r.keep_parent, 'parent', true)
      ON CONFLICT DO NOTHING;
    END IF;

    -- Move RSVPs from duplicate child to canonical (update child_id, skip conflicts)
    UPDATE rsvps SET child_id = r.keep_id 
    WHERE child_id = r.dup_id
      AND id NOT IN (SELECT id FROM rsvps WHERE child_id = r.keep_id AND event_id IN (SELECT event_id FROM rsvps WHERE child_id = r.dup_id));
    DELETE FROM rsvps WHERE child_id = r.dup_id;

    -- Remove duplicate team assignments
    DELETE FROM child_team_assignments WHERE child_id = r.dup_id;

    -- Remove duplicate child_guardians
    DELETE FROM child_guardians WHERE child_id = r.dup_id;

    -- Delete the duplicate child record
    DELETE FROM children WHERE id = r.dup_id;
  END LOOP;
END;
$$;
