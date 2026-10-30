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
BEGIN
  SELECT name, parent_id INTO v_new_child_name, v_new_parent_id
  FROM public.children
  WHERE id = NEW.child_id;

  SELECT c.id INTO v_existing_child_id
  FROM public.children c
  JOIN public.child_team_assignments cta ON cta.child_id = c.id
  WHERE cta.team_id = NEW.team_id
    AND lower(btrim(c.name)) = lower(btrim(v_new_child_name))
    AND c.id <> NEW.child_id
  LIMIT 1;

  IF v_existing_child_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Carry over the creating parent as guardian of the canonical child
  IF v_new_parent_id IS NOT NULL THEN
    INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
    VALUES (v_existing_child_id, v_new_parent_id, 'parent', false)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Carry over every other guardian already attached to the duplicate
  INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
  SELECT v_existing_child_id, cg.guardian_id, COALESCE(cg.relationship_type, 'parent'), false
  FROM public.child_guardians cg
  WHERE cg.child_id = NEW.child_id
  ON CONFLICT DO NOTHING;

  -- Only remove the duplicate when it carries no real data of its own
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

  -- Skip the duplicate assignment either way
  RETURN NULL;
END;
$$;