
-- Failsafe: silently swallow duplicate-key errors on rsvps inserts.
-- Frontend occasionally double-fires RSVP creation (rapid taps, retry-on-reconnect),
-- and three partial unique indexes (user/child/player x event) make it likely to race.
-- We treat duplicates as "already RSVP'd" instead of erroring.

CREATE OR REPLACE FUNCTION public.skip_duplicate_rsvps()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- user-only RSVP
  IF NEW.child_id IS NULL AND NEW.mini_league_player_id IS NULL AND NEW.user_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.rsvps
      WHERE event_id = NEW.event_id AND user_id = NEW.user_id
        AND child_id IS NULL AND mini_league_player_id IS NULL
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  -- child RSVP
  IF NEW.child_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.rsvps
      WHERE event_id = NEW.event_id AND child_id = NEW.child_id
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  -- mini-league player RSVP
  IF NEW.mini_league_player_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.rsvps
      WHERE event_id = NEW.event_id AND mini_league_player_id = NEW.mini_league_player_id
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS skip_duplicate_rsvps_trigger ON public.rsvps;
CREATE TRIGGER skip_duplicate_rsvps_trigger
BEFORE INSERT ON public.rsvps
FOR EACH ROW
EXECUTE FUNCTION public.skip_duplicate_rsvps();
