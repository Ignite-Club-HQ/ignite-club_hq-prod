-- 1. Pre-cleanup: dedupe linked events per (match, side), keep oldest.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY competition_match_id, competition_side
           ORDER BY created_at ASC, id ASC
         ) AS rn
    FROM public.events
   WHERE competition_match_id IS NOT NULL
     AND competition_side IS NOT NULL
)
DELETE FROM public.events e USING ranked r
 WHERE e.id = r.id AND r.rn > 1;

-- 2. Replace sync function: resolve linked event via (a) canonical match+side, (b) pointer, (c) adopt by title/team/date.
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
  v_description text;
  v_location text;
  v_location_name text;
  v_home_event uuid;
  v_away_event uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.events WHERE competition_match_id = OLD.id;
    IF OLD.home_event_id IS NOT NULL THEN
      DELETE FROM public.events WHERE id = OLD.home_event_id;
    END IF;
    IF OLD.away_event_id IS NOT NULL THEN
      DELETE FROM public.events WHERE id = OLD.away_event_id;
    END IF;
    RETURN OLD;
  END IF;

  SELECT id, name, club_id INTO v_home_team FROM public.teams WHERE id = NEW.home_team_id;
  SELECT id, name, club_id INTO v_away_team FROM public.teams WHERE id = NEW.away_team_id;
  SELECT id, name, created_by INTO v_comp FROM public.competitions WHERE id = NEW.competition_id;

  IF v_home_team.id IS NULL OR v_away_team.id IS NULL THEN
    RETURN NEW;
  END IF;

  v_creator := COALESCE(NEW.created_by, v_comp.created_by);
  IF v_creator IS NULL THEN
    RETURN NEW;
  END IF;

  v_title := v_home_team.name || ' vs ' || v_away_team.name;
  IF NEW.round_number IS NOT NULL THEN
    v_title := 'R' || NEW.round_number || ': ' || v_title;
  END IF;

  v_cancelled := NEW.status IN ('cancelled', 'postponed');

  IF v_comp.name IS NOT NULL THEN
    v_description := 'Competition: ' || v_comp.name;
    IF NEW.round_number IS NOT NULL THEN
      v_description := v_description || E'\nRound ' || NEW.round_number;
    END IF;
  ELSE
    v_description := NULL;
  END IF;

  v_location := NULLIF(btrim(COALESCE(NEW.venue, '')), '');
  IF v_location IS NOT NULL THEN
    v_location_name := split_part(v_location, ',', 1);
  ELSE
    v_location_name := NULL;
  END IF;

  IF NEW.scheduled_at IS NULL THEN
    DELETE FROM public.events WHERE competition_match_id = NEW.id;
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

  -- ===== HOME =====
  SELECT id INTO v_home_event
    FROM public.events
   WHERE competition_match_id = NEW.id AND competition_side = 'home'
   LIMIT 1;
  IF v_home_event IS NULL AND NEW.home_event_id IS NOT NULL THEN
    SELECT id INTO v_home_event FROM public.events WHERE id = NEW.home_event_id;
  END IF;
  IF v_home_event IS NULL THEN
    SELECT id INTO v_home_event
      FROM public.events
     WHERE club_id = v_home_team.club_id
       AND team_id = v_home_team.id
       AND type = 'game'
       AND lower(btrim(title)) = lower(btrim(v_title))
       AND event_date = NEW.scheduled_at
     LIMIT 1;
  END IF;

  IF v_home_event IS NULL THEN
    INSERT INTO public.events (
      club_id, team_id, title, event_date, type, opponent, is_home_game,
      location, location_name, description, created_by, is_cancelled,
      final_score_home, final_score_away,
      competition_match_id, competition_side
    ) VALUES (
      v_home_team.club_id, v_home_team.id, v_title, NEW.scheduled_at, 'game',
      v_away_team.name, true, v_location, v_location_name, v_description,
      v_creator, v_cancelled, NEW.home_score, NEW.away_score,
      NEW.id, 'home'
    )
    RETURNING id INTO v_home_event;
  ELSE
    UPDATE public.events
       SET title = v_title,
           event_date = NEW.scheduled_at,
           team_id = v_home_team.id,
           club_id = v_home_team.club_id,
           opponent = v_away_team.name,
           location = v_location,
           location_name = v_location_name,
           description = v_description,
           is_cancelled = v_cancelled,
           is_home_game = true,
           final_score_home = NEW.home_score,
           final_score_away = NEW.away_score,
           competition_match_id = NEW.id,
           competition_side = 'home'
     WHERE id = v_home_event;
  END IF;
  NEW.home_event_id := v_home_event;

  -- ===== AWAY =====
  SELECT id INTO v_away_event
    FROM public.events
   WHERE competition_match_id = NEW.id AND competition_side = 'away'
   LIMIT 1;
  IF v_away_event IS NULL AND NEW.away_event_id IS NOT NULL THEN
    SELECT id INTO v_away_event FROM public.events WHERE id = NEW.away_event_id;
  END IF;
  IF v_away_event IS NULL THEN
    SELECT id INTO v_away_event
      FROM public.events
     WHERE club_id = v_away_team.club_id
       AND team_id = v_away_team.id
       AND type = 'game'
       AND lower(btrim(title)) = lower(btrim(v_title))
       AND event_date = NEW.scheduled_at
     LIMIT 1;
  END IF;

  IF v_away_event IS NULL THEN
    INSERT INTO public.events (
      club_id, team_id, title, event_date, type, opponent, is_home_game,
      location, location_name, description, created_by, is_cancelled,
      final_score_home, final_score_away,
      competition_match_id, competition_side
    ) VALUES (
      v_away_team.club_id, v_away_team.id, v_title, NEW.scheduled_at, 'game',
      v_home_team.name, false, v_location, v_location_name, v_description,
      v_creator, v_cancelled, NEW.home_score, NEW.away_score,
      NEW.id, 'away'
    )
    RETURNING id INTO v_away_event;
  ELSE
    UPDATE public.events
       SET title = v_title,
           event_date = NEW.scheduled_at,
           team_id = v_away_team.id,
           club_id = v_away_team.club_id,
           opponent = v_home_team.name,
           location = v_location,
           location_name = v_location_name,
           description = v_description,
           is_cancelled = v_cancelled,
           is_home_game = false,
           final_score_home = NEW.home_score,
           final_score_away = NEW.away_score,
           competition_match_id = NEW.id,
           competition_side = 'away'
     WHERE id = v_away_event;
  END IF;
  NEW.away_event_id := v_away_event;

  RETURN NEW;
END;
$$;

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
