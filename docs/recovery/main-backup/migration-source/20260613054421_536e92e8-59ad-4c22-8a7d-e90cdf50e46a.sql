-- Inherit scoping fields (mini_league_id, team_id, club_id, restricted_to_roles)
-- from parent_event_id when missing on the child row. Prevents recurring
-- children from silently widening their audience to the whole club when a
-- client forgets to copy these fields.
CREATE OR REPLACE FUNCTION public.inherit_parent_event_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent RECORD;
BEGIN
  IF NEW.parent_event_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT mini_league_id, team_id, club_id, restricted_to_roles
  INTO parent
  FROM public.events
  WHERE id = NEW.parent_event_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.mini_league_id IS NULL AND parent.mini_league_id IS NOT NULL THEN
    NEW.mini_league_id := parent.mini_league_id;
  END IF;

  IF NEW.team_id IS NULL AND parent.team_id IS NOT NULL THEN
    NEW.team_id := parent.team_id;
  END IF;

  IF NEW.club_id IS NULL AND parent.club_id IS NOT NULL THEN
    NEW.club_id := parent.club_id;
  END IF;

  IF NEW.restricted_to_roles IS NULL AND parent.restricted_to_roles IS NOT NULL THEN
    NEW.restricted_to_roles := parent.restricted_to_roles;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_inherit_parent_scope ON public.events;
CREATE TRIGGER events_inherit_parent_scope
  BEFORE INSERT OR UPDATE OF parent_event_id ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.inherit_parent_event_scope();