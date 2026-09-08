-- Children are club-local records: the same human can exist as a separate row
-- per club. The duplicate guard must therefore only block true duplicates in a
-- parent's own list (an unrostered same-name entry), not a child who is already
-- rostered at another club.
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
    -- Only an unrostered record counts as a duplicate; a child rostered in
    -- another club/mini-league is a separate club-local record.
    AND NOT EXISTS (
      SELECT 1 FROM public.child_team_assignments cta WHERE cta.child_id = c.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.child_mini_league_assignments cml WHERE cml.child_id = c.id
    )
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate_child_for_parent: % is already in your children list', btrim(NEW.name)
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

-- The global unique index cannot express club scope, so it wrongly blocked the
-- second club's record. The trigger above remains the guard.
DROP INDEX IF EXISTS public.idx_children_parent_name_yob_unique;