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

DROP TRIGGER IF EXISTS prevent_duplicate_child_for_parent_trg ON public.children;
CREATE TRIGGER prevent_duplicate_child_for_parent_trg
BEFORE INSERT ON public.children
FOR EACH ROW EXECUTE FUNCTION public.prevent_duplicate_child_for_parent();