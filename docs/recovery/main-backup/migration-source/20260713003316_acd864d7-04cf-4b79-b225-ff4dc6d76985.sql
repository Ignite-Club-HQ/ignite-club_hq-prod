
CREATE OR REPLACE FUNCTION public.cascade_club_soft_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete transition: NULL -> NOT NULL
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    UPDATE public.teams
       SET deleted_at = NEW.deleted_at,
           deleted_by = NEW.deleted_by
     WHERE club_id = NEW.id
       AND deleted_at IS NULL;

    UPDATE public.chat_groups
       SET deleted_at = NEW.deleted_at,
           deleted_by = NEW.deleted_by
     WHERE deleted_at IS NULL
       AND (
         club_id = NEW.id
         OR team_id IN (SELECT id FROM public.teams WHERE club_id = NEW.id)
       );

  -- Restore transition: NOT NULL -> NULL
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    UPDATE public.teams
       SET deleted_at = NULL,
           deleted_by = NULL
     WHERE club_id = NEW.id
       AND deleted_at = OLD.deleted_at;

    UPDATE public.chat_groups
       SET deleted_at = NULL,
           deleted_by = NULL
     WHERE deleted_at = OLD.deleted_at
       AND (
         club_id = NEW.id
         OR team_id IN (SELECT id FROM public.teams WHERE club_id = NEW.id)
       );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascade_club_soft_delete ON public.clubs;
CREATE TRIGGER trg_cascade_club_soft_delete
AFTER UPDATE OF deleted_at ON public.clubs
FOR EACH ROW
EXECUTE FUNCTION public.cascade_club_soft_delete();
