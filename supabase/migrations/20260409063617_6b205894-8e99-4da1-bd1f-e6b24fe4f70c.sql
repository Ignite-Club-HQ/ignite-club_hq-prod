-- Create a trigger function to prevent duplicate children on the same team
CREATE OR REPLACE FUNCTION public.prevent_duplicate_child_on_team()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_child_name text;
  v_existing_child_id uuid;
  v_new_parent_id uuid;
BEGIN
  -- Get the name of the child being assigned
  SELECT name, parent_id INTO v_new_child_name, v_new_parent_id
  FROM public.children
  WHERE id = NEW.child_id;

  -- Check if another child with the same name is already on this team
  SELECT c.id INTO v_existing_child_id
  FROM public.children c
  JOIN public.child_team_assignments cta ON cta.child_id = c.id
  WHERE cta.team_id = NEW.team_id
    AND lower(btrim(c.name)) = lower(btrim(v_new_child_name))
    AND c.id != NEW.child_id
  LIMIT 1;

  IF v_existing_child_id IS NOT NULL THEN
    -- Link the new child's parent as a guardian of the existing child
    INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
    VALUES (v_existing_child_id, v_new_parent_id, 'parent', false)
    ON CONFLICT DO NOTHING;

    -- Skip the duplicate assignment
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- Attach the trigger
DROP TRIGGER IF EXISTS trg_prevent_duplicate_child_on_team ON public.child_team_assignments;
CREATE TRIGGER trg_prevent_duplicate_child_on_team
  BEFORE INSERT ON public.child_team_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_duplicate_child_on_team();