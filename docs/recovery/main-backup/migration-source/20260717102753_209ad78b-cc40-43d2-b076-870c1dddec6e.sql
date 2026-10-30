
-- 1) Backfill: ensure every children.parent_id has a matching child_guardians row
INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
SELECT c.id, c.parent_id, 'parent', true
FROM public.children c
WHERE c.parent_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.child_guardians cg
    WHERE cg.child_id = c.id AND cg.guardian_id = c.parent_id
  );

-- 2) Trigger: auto-link parent_id as a guardian on new children (and when parent_id changes)
CREATE OR REPLACE FUNCTION public.sync_child_parent_to_guardian()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    INSERT INTO public.child_guardians (child_id, guardian_id, relationship_type, is_primary)
    VALUES (NEW.id, NEW.parent_id, 'parent', true)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_child_parent_to_guardian ON public.children;
CREATE TRIGGER trg_sync_child_parent_to_guardian
AFTER INSERT OR UPDATE OF parent_id ON public.children
FOR EACH ROW EXECUTE FUNCTION public.sync_child_parent_to_guardian();
