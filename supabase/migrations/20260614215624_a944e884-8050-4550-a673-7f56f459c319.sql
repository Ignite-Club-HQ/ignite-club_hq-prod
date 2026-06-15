-- Prevent RSVPing children or mini-league players to role-restricted events
-- where the restriction excludes 'player'. Children are members in a player
-- capacity only; a "Committee" or other adult-role-only event must never
-- accept a child/player RSVP row.

CREATE OR REPLACE FUNCTION public.enforce_rsvp_role_restriction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _restricted text[];
BEGIN
  IF NEW.child_id IS NULL AND NEW.mini_league_player_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT restricted_to_roles INTO _restricted
  FROM public.events
  WHERE id = NEW.event_id;

  IF _restricted IS NULL OR array_length(_restricted, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  IF 'player' = ANY(_restricted) OR 'parent' = ANY(_restricted) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Children/players cannot RSVP to events restricted to roles: %', _restricted
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_rsvp_role_restriction ON public.rsvps;
CREATE TRIGGER trg_enforce_rsvp_role_restriction
  BEFORE INSERT OR UPDATE OF child_id, mini_league_player_id, event_id ON public.rsvps
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_rsvp_role_restriction();

-- Clean up the stray row that exposed this gap (Casey's not_going on the
-- Committee Meeting). Safe because the event is role-restricted to
-- committee_member and child RSVPs can never be valid there.
DELETE FROM public.rsvps
WHERE id = 'b24cd7de-46a8-42b7-9bdc-bb8ee2214a68';
