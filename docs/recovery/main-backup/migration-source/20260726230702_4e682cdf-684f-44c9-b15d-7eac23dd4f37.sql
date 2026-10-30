-- Team soft-delete/purge cascade
CREATE OR REPLACE FUNCTION public.cascade_team_soft_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Soft-delete transition on teams.deleted_at: NULL -> NOT NULL
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    UPDATE public.chat_groups
       SET deleted_at = NEW.deleted_at, deleted_by = NEW.deleted_by
     WHERE team_id = NEW.id AND deleted_at IS NULL;

    UPDATE public.events
       SET is_cancelled = TRUE
     WHERE team_id = NEW.id AND COALESCE(is_cancelled, FALSE) = FALSE;

    UPDATE public.photos
       SET deleted_at = NEW.deleted_at
     WHERE team_id = NEW.id AND deleted_at IS NULL;

  -- Restore transition on teams.deleted_at: NOT NULL -> NULL
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    UPDATE public.chat_groups
       SET deleted_at = NULL, deleted_by = NULL
     WHERE team_id = NEW.id AND deleted_at IS NOT NULL AND purged_at IS NULL;
    -- Events remain cancelled and photos remain hidden; admins can restore individually.
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascade_team_soft_delete ON public.teams;
CREATE TRIGGER trg_cascade_team_soft_delete
AFTER UPDATE OF deleted_at ON public.teams
FOR EACH ROW
EXECUTE FUNCTION public.cascade_team_soft_delete();

-- Extend club cascade to also hide team events and photos
CREATE OR REPLACE FUNCTION public.cascade_club_soft_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    UPDATE public.teams
       SET deleted_at = NEW.deleted_at, deleted_by = NEW.deleted_by
     WHERE club_id = NEW.id AND deleted_at IS NULL;

    UPDATE public.chat_groups
       SET deleted_at = NEW.deleted_at, deleted_by = NEW.deleted_by
     WHERE deleted_at IS NULL
       AND (club_id = NEW.id
            OR team_id IN (SELECT id FROM public.teams WHERE club_id = NEW.id));

    UPDATE public.events
       SET is_cancelled = TRUE
     WHERE COALESCE(is_cancelled, FALSE) = FALSE
       AND (club_id = NEW.id
            OR team_id IN (SELECT id FROM public.teams WHERE club_id = NEW.id));

    UPDATE public.photos
       SET deleted_at = NEW.deleted_at
     WHERE deleted_at IS NULL
       AND (club_id = NEW.id
            OR team_id IN (SELECT id FROM public.teams WHERE club_id = NEW.id));

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

    UPDATE public.events
       SET is_cancelled = TRUE
     WHERE COALESCE(is_cancelled, FALSE) = FALSE
       AND (club_id = NEW.id
            OR team_id IN (SELECT id FROM public.teams WHERE club_id = NEW.id));

    UPDATE public.photos
       SET deleted_at = COALESCE(deleted_at, NEW.purged_at)
     WHERE (club_id = NEW.id
            OR team_id IN (SELECT id FROM public.teams WHERE club_id = NEW.id));
  END IF;

  RETURN NEW;
END;
$$;

-- Backfill: apply cascade to teams already soft-deleted
UPDATE public.chat_groups cg
   SET deleted_at = t.deleted_at, deleted_by = t.deleted_by
  FROM public.teams t
 WHERE cg.team_id = t.id
   AND t.deleted_at IS NOT NULL
   AND cg.deleted_at IS NULL;

UPDATE public.events e
   SET is_cancelled = TRUE
  FROM public.teams t
 WHERE e.team_id = t.id
   AND t.deleted_at IS NOT NULL
   AND COALESCE(e.is_cancelled, FALSE) = FALSE;

UPDATE public.photos p
   SET deleted_at = t.deleted_at
  FROM public.teams t
 WHERE p.team_id = t.id
   AND t.deleted_at IS NOT NULL
   AND p.deleted_at IS NULL;