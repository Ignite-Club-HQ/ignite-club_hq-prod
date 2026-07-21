
CREATE OR REPLACE FUNCTION public.cascade_club_soft_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Soft-delete transition on clubs.deleted_at: NULL -> NOT NULL
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    UPDATE public.teams
       SET deleted_at = NEW.deleted_at, deleted_by = NEW.deleted_by
     WHERE club_id = NEW.id AND deleted_at IS NULL;

    UPDATE public.chat_groups
       SET deleted_at = NEW.deleted_at, deleted_by = NEW.deleted_by
     WHERE deleted_at IS NULL
       AND (club_id = NEW.id
            OR team_id IN (SELECT id FROM public.teams WHERE club_id = NEW.id));

  -- Restore transition on clubs.deleted_at: NOT NULL -> NULL
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    UPDATE public.teams
       SET deleted_at = NULL, deleted_by = NULL
     WHERE club_id = NEW.id AND deleted_at IS NOT NULL AND purged_at IS NULL;

    UPDATE public.chat_groups
       SET deleted_at = NULL, deleted_by = NULL
     WHERE deleted_at IS NOT NULL
       AND (club_id = NEW.id
            OR team_id IN (SELECT id FROM public.teams WHERE club_id = NEW.id));
  END IF;

  -- Permanent-delete transition on clubs.purged_at: NULL -> NOT NULL.
  -- Guarantees children are hidden even if soft-delete cascade missed them.
  IF OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL THEN
    UPDATE public.teams
       SET deleted_at = COALESCE(deleted_at, NEW.purged_at),
           deleted_by = COALESCE(deleted_by, NEW.purged_by)
     WHERE club_id = NEW.id;

    UPDATE public.chat_groups
       SET deleted_at = COALESCE(deleted_at, NEW.purged_at),
           deleted_by = COALESCE(deleted_by, NEW.purged_by)
     WHERE (club_id = NEW.id
            OR team_id IN (SELECT id FROM public.teams WHERE club_id = NEW.id));
  END IF;

  RETURN NEW;
END;
$function$;

-- Restore trigger relies on purged_at check; ensure teams table has purged_at not required
-- (we don't need to add it; the ELSIF branch just adds a guard to avoid restoring purged children)

-- Ensure trigger fires on updates to purged_at as well as deleted_at
DROP TRIGGER IF EXISTS trg_cascade_club_soft_delete ON public.clubs;
CREATE TRIGGER trg_cascade_club_soft_delete
AFTER UPDATE OF deleted_at, purged_at ON public.clubs
FOR EACH ROW
EXECUTE FUNCTION public.cascade_club_soft_delete();
