
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS competition_match_id uuid REFERENCES public.competition_matches(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS competition_side text CHECK (competition_side IN ('home','away'));

CREATE UNIQUE INDEX IF NOT EXISTS events_competition_match_side_uniq
  ON public.events(competition_match_id, competition_side)
  WHERE competition_match_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_competition_match_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp RECORD;
  v_home_team RECORD;
  v_away_team RECORD;
  v_created_by uuid;
  v_title_home text;
  v_title_away text;
  v_venue text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.events WHERE competition_match_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.scheduled_at IS NULL OR NEW.home_team_id IS NULL OR NEW.away_team_id IS NULL THEN
    DELETE FROM public.events WHERE competition_match_id = NEW.id;
    RETURN NEW;
  END IF;

  SELECT id, name INTO v_comp FROM public.competitions WHERE id = NEW.competition_id;
  SELECT id, name, club_id INTO v_home_team FROM public.teams WHERE id = NEW.home_team_id;
  SELECT id, name, club_id INTO v_away_team FROM public.teams WHERE id = NEW.away_team_id;

  IF v_home_team.club_id IS NULL OR v_away_team.club_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_created_by := COALESCE(NEW.created_by, (SELECT created_by FROM public.competitions WHERE id = NEW.competition_id));
  IF v_created_by IS NULL THEN
    RETURN NEW;
  END IF;

  v_venue := NEW.venue;
  v_title_home := 'vs ' || COALESCE(v_away_team.name, 'TBD');
  v_title_away := 'vs ' || COALESCE(v_home_team.name, 'TBD');

  -- Home team event
  INSERT INTO public.events (
    club_id, team_id, title, type, event_date, location, opponent, is_home_game,
    is_cancelled, created_by, competition_match_id, competition_side, description
  ) VALUES (
    v_home_team.club_id, v_home_team.id, v_title_home, 'game'::event_type, NEW.scheduled_at,
    v_venue, v_away_team.name, true,
    (NEW.status = 'cancelled'), v_created_by, NEW.id, 'home',
    COALESCE(v_comp.name, '') || CASE WHEN NEW.round_number IS NOT NULL THEN ' · Round ' || NEW.round_number ELSE '' END
  )
  ON CONFLICT (competition_match_id, competition_side) WHERE competition_match_id IS NOT NULL
  DO UPDATE SET
    team_id = EXCLUDED.team_id,
    club_id = EXCLUDED.club_id,
    title = EXCLUDED.title,
    event_date = EXCLUDED.event_date,
    location = EXCLUDED.location,
    opponent = EXCLUDED.opponent,
    is_cancelled = EXCLUDED.is_cancelled,
    description = EXCLUDED.description,
    updated_at = now();

  -- Away team event
  INSERT INTO public.events (
    club_id, team_id, title, type, event_date, location, opponent, is_home_game,
    is_cancelled, created_by, competition_match_id, competition_side, description
  ) VALUES (
    v_away_team.club_id, v_away_team.id, v_title_away, 'game'::event_type, NEW.scheduled_at,
    v_venue, v_home_team.name, false,
    (NEW.status = 'cancelled'), v_created_by, NEW.id, 'away',
    COALESCE(v_comp.name, '') || CASE WHEN NEW.round_number IS NOT NULL THEN ' · Round ' || NEW.round_number ELSE '' END
  )
  ON CONFLICT (competition_match_id, competition_side) WHERE competition_match_id IS NOT NULL
  DO UPDATE SET
    team_id = EXCLUDED.team_id,
    club_id = EXCLUDED.club_id,
    title = EXCLUDED.title,
    event_date = EXCLUDED.event_date,
    location = EXCLUDED.location,
    opponent = EXCLUDED.opponent,
    is_cancelled = EXCLUDED.is_cancelled,
    description = EXCLUDED.description,
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_competition_match_events ON public.competition_matches;
CREATE TRIGGER trg_sync_competition_match_events
AFTER INSERT OR UPDATE OR DELETE ON public.competition_matches
FOR EACH ROW EXECUTE FUNCTION public.sync_competition_match_events();

-- Backfill: re-run the trigger for existing fixtures by touching them
UPDATE public.competition_matches SET updated_at = now() WHERE scheduled_at IS NOT NULL;
