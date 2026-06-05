
-- 1. Add event linkage columns to competition_matches
ALTER TABLE public.competition_matches
  ADD COLUMN IF NOT EXISTS home_event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS away_event_id uuid REFERENCES public.events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_competition_matches_home_event ON public.competition_matches(home_event_id);
CREATE INDEX IF NOT EXISTS idx_competition_matches_away_event ON public.competition_matches(away_event_id);

-- 2. Sync function: maintains paired events per fixture
CREATE OR REPLACE FUNCTION public.sync_competition_match_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_home_team RECORD;
  v_away_team RECORD;
  v_comp RECORD;
  v_creator uuid;
  v_title text;
  v_cancelled boolean;
BEGIN
  -- DELETE: drop both linked events
  IF TG_OP = 'DELETE' THEN
    IF OLD.home_event_id IS NOT NULL THEN
      DELETE FROM public.events WHERE id = OLD.home_event_id;
    END IF;
    IF OLD.away_event_id IS NOT NULL THEN
      DELETE FROM public.events WHERE id = OLD.away_event_id;
    END IF;
    RETURN OLD;
  END IF;

  -- INSERT/UPDATE: only act if we have teams
  SELECT id, name, club_id INTO v_home_team FROM public.teams WHERE id = NEW.home_team_id;
  SELECT id, name, club_id INTO v_away_team FROM public.teams WHERE id = NEW.away_team_id;
  SELECT id, name, created_by INTO v_comp FROM public.competitions WHERE id = NEW.competition_id;

  IF v_home_team.id IS NULL OR v_away_team.id IS NULL THEN
    RETURN NEW;
  END IF;

  v_creator := COALESCE(NEW.created_by, v_comp.created_by);
  IF v_creator IS NULL THEN
    -- Cannot create events without a creator; skip silently.
    RETURN NEW;
  END IF;

  v_title := v_home_team.name || ' vs ' || v_away_team.name;
  IF NEW.round_number IS NOT NULL THEN
    v_title := 'R' || NEW.round_number || ': ' || v_title;
  END IF;

  v_cancelled := NEW.status IN ('cancelled', 'postponed');

  -- If no scheduled_at, remove any existing linked events (they'll be recreated when rescheduled)
  IF NEW.scheduled_at IS NULL THEN
    IF NEW.home_event_id IS NOT NULL THEN
      DELETE FROM public.events WHERE id = NEW.home_event_id;
      NEW.home_event_id := NULL;
    END IF;
    IF NEW.away_event_id IS NOT NULL THEN
      DELETE FROM public.events WHERE id = NEW.away_event_id;
      NEW.away_event_id := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- HOME event
  IF NEW.home_event_id IS NULL THEN
    INSERT INTO public.events (
      club_id, team_id, title, event_date, type, opponent, is_home_game,
      location, created_by, is_cancelled
    ) VALUES (
      v_home_team.club_id, v_home_team.id, v_title, NEW.scheduled_at, 'game',
      v_away_team.name, true, NEW.venue, v_creator, v_cancelled
    )
    RETURNING id INTO NEW.home_event_id;
  ELSE
    UPDATE public.events
      SET title = v_title,
          event_date = NEW.scheduled_at,
          opponent = v_away_team.name,
          location = NEW.venue,
          is_cancelled = v_cancelled,
          is_home_game = true
      WHERE id = NEW.home_event_id;
  END IF;

  -- AWAY event
  IF NEW.away_event_id IS NULL THEN
    INSERT INTO public.events (
      club_id, team_id, title, event_date, type, opponent, is_home_game,
      location, created_by, is_cancelled
    ) VALUES (
      v_away_team.club_id, v_away_team.id, v_title, NEW.scheduled_at, 'game',
      v_home_team.name, false, NEW.venue, v_creator, v_cancelled
    )
    RETURNING id INTO NEW.away_event_id;
  ELSE
    UPDATE public.events
      SET title = v_title,
          event_date = NEW.scheduled_at,
          opponent = v_home_team.name,
          location = NEW.venue,
          is_cancelled = v_cancelled,
          is_home_game = false
      WHERE id = NEW.away_event_id;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Triggers
DROP TRIGGER IF EXISTS trg_sync_competition_match_events_iu ON public.competition_matches;
CREATE TRIGGER trg_sync_competition_match_events_iu
  BEFORE INSERT OR UPDATE ON public.competition_matches
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_competition_match_events();

DROP TRIGGER IF EXISTS trg_sync_competition_match_events_d ON public.competition_matches;
CREATE TRIGGER trg_sync_competition_match_events_d
  AFTER DELETE ON public.competition_matches
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_competition_match_events();

-- 4. Backfill: create events for existing fixtures with a scheduled_at and no linked events
UPDATE public.competition_matches SET updated_at = updated_at WHERE scheduled_at IS NOT NULL AND home_event_id IS NULL;
