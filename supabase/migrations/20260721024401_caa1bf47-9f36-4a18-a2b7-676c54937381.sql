
-- Phase 1: WARN-ONLY validation that events.team_id belongs to events.club_id.
-- Fires AFTER events_inherit_parent_scope (name-sorted) so recurring children
-- inherit their scope first and are then validated on the resulting values.

CREATE OR REPLACE FUNCTION public.validate_event_team_club_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  team_club uuid;
BEGIN
  -- Club-wide event: nothing to validate.
  IF NEW.team_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT club_id INTO team_club FROM public.teams WHERE id = NEW.team_id;

  IF team_club IS NULL THEN
    RAISE WARNING 'events scope check: team_id % has no matching team row (event club_id=%)',
      NEW.team_id, NEW.club_id;
    BEGIN
      INSERT INTO public.audit_logs (action, resource_type, resource_id, metadata)
      VALUES (
        'events_scope_warning',
        'events',
        NEW.id::text,
        jsonb_build_object(
          'reason', 'team_missing',
          'team_id', NEW.team_id,
          'club_id', NEW.club_id,
          'op', TG_OP
        )
      );
    EXCEPTION WHEN OTHERS THEN
      -- Never let audit logging block the write during warn phase.
      NULL;
    END;
    RETURN NEW;
  END IF;

  IF team_club <> NEW.club_id THEN
    RAISE WARNING 'events scope check: team % belongs to club %, event stored club %',
      NEW.team_id, team_club, NEW.club_id;
    BEGIN
      INSERT INTO public.audit_logs (action, resource_type, resource_id, metadata)
      VALUES (
        'events_scope_warning',
        'events',
        NEW.id::text,
        jsonb_build_object(
          'reason', 'club_mismatch',
          'team_id', NEW.team_id,
          'team_club_id', team_club,
          'event_club_id', NEW.club_id,
          'op', TG_OP
        )
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$;

-- Name deliberately chosen to sort AFTER events_inherit_parent_scope so
-- recurring children have their scope inherited before validation runs.
DROP TRIGGER IF EXISTS trg_validate_event_scope ON public.events;
CREATE TRIGGER trg_validate_event_scope
BEFORE INSERT OR UPDATE OF team_id, club_id, parent_event_id
ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.validate_event_team_club_scope();

COMMENT ON FUNCTION public.validate_event_team_club_scope() IS
  'Phase 1 (warn-only): logs when an event is written with a team belonging to a different club. Phase 2 will switch RAISE WARNING to RAISE EXCEPTION after observation window.';
