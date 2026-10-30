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
  IF TG_OP = 'DELETE' THEN
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

  IF NEW.home_event_id IS NULL THEN
    INSERT INTO public.events (
      club_id, team_id, title, event_date, type, opponent, is_home_game,
      location, created_by, is_cancelled, final_score_home, final_score_away
    ) VALUES (
      v_home_team.club_id, v_home_team.id, v_title, NEW.scheduled_at, 'game',
      v_away_team.name, true, NEW.venue, v_creator, v_cancelled,
      NEW.home_score, NEW.away_score
    )
    RETURNING id INTO NEW.home_event_id;
  ELSE
    UPDATE public.events
      SET title = v_title,
          event_date = NEW.scheduled_at,
          opponent = v_away_team.name,
          location = NEW.venue,
          is_cancelled = v_cancelled,
          is_home_game = true,
          final_score_home = NEW.home_score,
          final_score_away = NEW.away_score
      WHERE id = NEW.home_event_id;
  END IF;

  IF NEW.away_event_id IS NULL THEN
    INSERT INTO public.events (
      club_id, team_id, title, event_date, type, opponent, is_home_game,
      location, created_by, is_cancelled, final_score_home, final_score_away
    ) VALUES (
      v_away_team.club_id, v_away_team.id, v_title, NEW.scheduled_at, 'game',
      v_home_team.name, false, NEW.venue, v_creator, v_cancelled,
      NEW.home_score, NEW.away_score
    )
    RETURNING id INTO NEW.away_event_id;
  ELSE
    UPDATE public.events
      SET title = v_title,
          event_date = NEW.scheduled_at,
          opponent = v_home_team.name,
          location = NEW.venue,
          is_cancelled = v_cancelled,
          is_home_game = false,
          final_score_home = NEW.home_score,
          final_score_away = NEW.away_score
      WHERE id = NEW.away_event_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Backfill existing matches that have scores so the events reflect them.
UPDATE public.competition_matches
  SET updated_at = updated_at
  WHERE (home_score IS NOT NULL OR away_score IS NOT NULL)
    AND (home_event_id IS NOT NULL OR away_event_id IS NOT NULL);