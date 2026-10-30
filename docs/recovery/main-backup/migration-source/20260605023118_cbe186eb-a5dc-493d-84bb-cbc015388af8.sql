
ALTER TABLE public.competition_matches
  ADD COLUMN IF NOT EXISTS pitch_number text;

CREATE OR REPLACE FUNCTION public.sync_competition_match_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_home_team RECORD;
  v_away_team RECORD;
  v_comp RECORD;
  v_creator uuid;
  v_title text;
  v_cancelled boolean;
  v_end timestamptz;
  v_meet timestamptz;
  v_location text;
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

  v_end := CASE WHEN NEW.duration_minutes IS NOT NULL
                THEN NEW.scheduled_at + make_interval(mins => NEW.duration_minutes)
                ELSE NULL END;
  v_meet := CASE WHEN NEW.arrival_minutes_before IS NOT NULL
                 THEN NEW.scheduled_at - make_interval(mins => NEW.arrival_minutes_before)
                 ELSE NULL END;

  v_location := NEW.venue;
  IF NEW.pitch_number IS NOT NULL AND length(trim(NEW.pitch_number)) > 0 THEN
    v_location := COALESCE(v_location || ' — ', '') || 'Pitch ' || NEW.pitch_number;
  END IF;

  IF NEW.home_event_id IS NULL THEN
    INSERT INTO public.events (
      club_id, team_id, title, event_date, type, opponent, is_home_game,
      location, created_by, is_cancelled, description, start_time, end_time,
      meet_time, arrival_minutes_before, competition_match_id, competition_side
    ) VALUES (
      v_home_team.club_id, v_home_team.id, v_title, NEW.scheduled_at, 'game',
      v_away_team.name, true, v_location, v_creator, v_cancelled, NEW.notes,
      NEW.scheduled_at, v_end, v_meet, NEW.arrival_minutes_before, NEW.id, 'home'
    )
    RETURNING id INTO NEW.home_event_id;
  ELSE
    UPDATE public.events
      SET title = v_title,
          event_date = NEW.scheduled_at,
          opponent = v_away_team.name,
          location = v_location,
          is_cancelled = v_cancelled,
          is_home_game = true,
          description = NEW.notes,
          start_time = NEW.scheduled_at,
          end_time = v_end,
          meet_time = v_meet,
          arrival_minutes_before = NEW.arrival_minutes_before,
          competition_match_id = NEW.id,
          competition_side = 'home'
      WHERE id = NEW.home_event_id;
  END IF;

  IF NEW.away_event_id IS NULL THEN
    INSERT INTO public.events (
      club_id, team_id, title, event_date, type, opponent, is_home_game,
      location, created_by, is_cancelled, description, start_time, end_time,
      meet_time, arrival_minutes_before, competition_match_id, competition_side
    ) VALUES (
      v_away_team.club_id, v_away_team.id, v_title, NEW.scheduled_at, 'game',
      v_home_team.name, false, v_location, v_creator, v_cancelled, NEW.notes,
      NEW.scheduled_at, v_end, v_meet, NEW.arrival_minutes_before, NEW.id, 'away'
    )
    RETURNING id INTO NEW.away_event_id;
  ELSE
    UPDATE public.events
      SET title = v_title,
          event_date = NEW.scheduled_at,
          opponent = v_home_team.name,
          location = v_location,
          is_cancelled = v_cancelled,
          is_home_game = false,
          description = NEW.notes,
          start_time = NEW.scheduled_at,
          end_time = v_end,
          meet_time = v_meet,
          arrival_minutes_before = NEW.arrival_minutes_before,
          competition_match_id = NEW.id,
          competition_side = 'away'
      WHERE id = NEW.away_event_id;
  END IF;

  RETURN NEW;
END;
$function$;
