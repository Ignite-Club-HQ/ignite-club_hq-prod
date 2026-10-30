CREATE OR REPLACE FUNCTION public.cascade_team_soft_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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

    -- Competition participation is withdrawn so the team stops mapping its club
    -- into the competition (chat visibility, counts, broadcast targeting).
    UPDATE public.competition_entries
       SET status = 'withdrawn',
           responded_by = NEW.deleted_by,
           responded_at = NEW.deleted_at,
           updated_at = now()
     WHERE team_id = NEW.id
       AND status <> 'withdrawn';

  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    UPDATE public.chat_groups
       SET deleted_at = NULL, deleted_by = NULL
     WHERE team_id = NEW.id AND deleted_at IS NOT NULL AND purged_at IS NULL;
    -- Events remain cancelled, photos remain hidden and competition entries
    -- remain withdrawn; admins re-enter the competition explicitly.
  END IF;

  RETURN NEW;
END;
$$;

-- Backfill: teams already soft-deleted still hold live entries.
UPDATE public.competition_entries ce
   SET status = 'withdrawn', updated_at = now()
  FROM public.teams t
 WHERE t.id = ce.team_id
   AND t.deleted_at IS NOT NULL
   AND ce.status <> 'withdrawn';