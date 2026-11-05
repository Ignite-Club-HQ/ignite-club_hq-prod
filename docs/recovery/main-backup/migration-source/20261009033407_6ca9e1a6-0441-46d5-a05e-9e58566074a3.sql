CREATE OR REPLACE FUNCTION public.sync_competition_match_events()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_home_team RECORD; v_away_team RECORD; v_comp RECORD;
  v_creator uuid; v_title text; v_cancelled boolean; v_description text;
  v_location text; v_location_name text; v_home_event uuid; v_away_event uuid;
  v_has_score boolean; v_placeholder boolean; v_home_name text; v_away_name text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.events WHERE competition_match_id = OLD.id;
    IF OLD.home_event_id IS NOT NULL THEN DELETE FROM public.events WHERE id = OLD.home_event_id; END IF;
    IF OLD.away_event_id IS NOT NULL THEN DELETE FROM public.events WHERE id = OLD.away_event_id; END IF;
    RETURN OLD;
  END IF;

  SELECT id, name, club_id INTO v_home_team FROM public.teams WHERE id = NEW.home_team_id;
  SELECT id, name, club_id INTO v_away_team FROM public.teams WHERE id = NEW.away_team_id;
  SELECT id, name, created_by, status INTO v_comp FROM public.competitions WHERE id = NEW.competition_id;

  IF v_comp.status = 'draft'
     AND NEW.home_event_id IS NULL AND NEW.away_event_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.events WHERE competition_match_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Both sides unknown: nothing to put on a schedule yet.
  IF v_home_team.id IS NULL AND v_away_team.id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Finals placeholder: one real team vs TBD. Its event is created silently.
  v_placeholder := v_home_team.id IS NULL OR v_away_team.id IS NULL;
  v_home_name := COALESCE(v_home_team.name, 'TBD');
  v_away_name := COALESCE(v_away_team.name, 'TBD');

  v_creator := COALESCE(NEW.created_by, v_comp.created_by);
  IF v_creator IS NULL THEN RETURN NEW; END IF;

  v_title := v_home_name || ' vs ' || v_away_name;
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
    IF NEW.pitch_number IS NOT NULL AND btrim(NEW.pitch_number::text) <> '' THEN
      v_location_name := v_location_name || ' - Pitch ' || NEW.pitch_number;
    END IF;
  ELSIF NEW.pitch_number IS NOT NULL AND btrim(NEW.pitch_number::text) <> '' THEN
    v_location_name := 'Pitch ' || NEW.pitch_number;
  ELSE
    v_location_name := NULL;
  END IF;

  IF NEW.scheduled_at IS NULL THEN
    DELETE FROM public.events WHERE competition_match_id = NEW.id;
    IF NEW.home_event_id IS NOT NULL THEN DELETE FROM public.events WHERE id = NEW.home_event_id; NEW.home_event_id := NULL; END IF;
    IF NEW.away_event_id IS NOT NULL THEN DELETE FROM public.events WHERE id = NEW.away_event_id; NEW.away_event_id := NULL; END IF;
    RETURN NEW;
  END IF;

  -- ===== HOME =====
  IF v_home_team.id IS NULL THEN
    DELETE FROM public.events WHERE competition_match_id = NEW.id AND competition_side = 'home';
    NEW.home_event_id := NULL;
  ELSE
    SELECT id INTO v_home_event FROM public.events
     WHERE competition_match_id = NEW.id AND competition_side = 'home' LIMIT 1;
    IF v_home_event IS NULL AND NEW.home_event_id IS NOT NULL THEN
      SELECT id INTO v_home_event FROM public.events WHERE id = NEW.home_event_id;
    END IF;
    IF v_home_event IS NULL THEN
      SELECT id INTO v_home_event FROM public.events
       WHERE club_id = v_home_team.club_id AND team_id = v_home_team.id AND type = 'game'
         AND lower(btrim(title)) = lower(btrim(v_title)) AND event_date = NEW.scheduled_at LIMIT 1;
    END IF;
    IF v_home_event IS NULL THEN
      INSERT INTO public.events (
        club_id, team_id, title, event_date, type, opponent, is_home_game,
        location, location_name, description, created_by, is_cancelled,
        final_score_home, final_score_away, competition_match_id, competition_side, notify_suppressed
      ) VALUES (
        v_home_team.club_id, v_home_team.id, v_title, NEW.scheduled_at, 'game',
        v_away_name, true, v_location, v_location_name, v_description,
        v_creator, v_cancelled, NEW.home_score, NEW.away_score, NEW.id, 'home', v_placeholder
      ) RETURNING id INTO v_home_event;
    ELSE
      UPDATE public.events
         SET title = v_title, event_date = NEW.scheduled_at, team_id = v_home_team.id,
             club_id = v_home_team.club_id, opponent = v_away_name, location = v_location,
             location_name = v_location_name, description = v_description, is_cancelled = v_cancelled,
             is_home_game = true, final_score_home = NEW.home_score, final_score_away = NEW.away_score,
             competition_match_id = NEW.id, competition_side = 'home'
       WHERE id = v_home_event;
    END IF;
    NEW.home_event_id := v_home_event;
  END IF;

  -- ===== AWAY =====
  IF v_away_team.id IS NULL THEN
    DELETE FROM public.events WHERE competition_match_id = NEW.id AND competition_side = 'away';
    NEW.away_event_id := NULL;
  ELSE
    SELECT id INTO v_away_event FROM public.events
     WHERE competition_match_id = NEW.id AND competition_side = 'away' LIMIT 1;
    IF v_away_event IS NULL AND NEW.away_event_id IS NOT NULL THEN
      SELECT id INTO v_away_event FROM public.events WHERE id = NEW.away_event_id;
    END IF;
    IF v_away_event IS NULL THEN
      SELECT id INTO v_away_event FROM public.events
       WHERE club_id = v_away_team.club_id AND team_id = v_away_team.id AND type = 'game'
         AND lower(btrim(title)) = lower(btrim(v_title)) AND event_date = NEW.scheduled_at LIMIT 1;
    END IF;
    IF v_away_event IS NULL THEN
      INSERT INTO public.events (
        club_id, team_id, title, event_date, type, opponent, is_home_game,
        location, location_name, description, created_by, is_cancelled,
        final_score_home, final_score_away, competition_match_id, competition_side, notify_suppressed
      ) VALUES (
        v_away_team.club_id, v_away_team.id, v_title, NEW.scheduled_at, 'game',
        v_home_name, false, v_location, v_location_name, v_description,
        v_creator, v_cancelled, NEW.home_score, NEW.away_score, NEW.id, 'away', v_placeholder
      ) RETURNING id INTO v_away_event;
    ELSE
      UPDATE public.events
         SET title = v_title, event_date = NEW.scheduled_at, team_id = v_away_team.id,
             club_id = v_away_team.club_id, opponent = v_home_name, location = v_location,
             location_name = v_location_name, description = v_description, is_cancelled = v_cancelled,
             is_home_game = false, final_score_home = NEW.home_score, final_score_away = NEW.away_score,
             competition_match_id = NEW.id, competition_side = 'away'
       WHERE id = v_away_event;
    END IF;
    NEW.away_event_id := v_away_event;
  END IF;

  v_has_score := NOT v_placeholder AND NEW.home_score IS NOT NULL AND NEW.away_score IS NOT NULL;
  IF v_has_score THEN
    INSERT INTO public.game_results (team_id, event_id, sport, home_label, away_label, home_score, away_score, saved_by, played_at)
    VALUES (v_home_team.id, v_home_event, 'soccer', v_home_team.name, v_away_team.name, NEW.home_score, NEW.away_score, v_creator, NEW.scheduled_at)
    ON CONFLICT (event_id) DO UPDATE SET home_label = EXCLUDED.home_label, away_label = EXCLUDED.away_label,
      home_score = EXCLUDED.home_score, away_score = EXCLUDED.away_score, team_id = EXCLUDED.team_id, updated_at = now();
    INSERT INTO public.game_results (team_id, event_id, sport, home_label, away_label, home_score, away_score, saved_by, played_at)
    VALUES (v_away_team.id, v_away_event, 'soccer', v_away_team.name, v_home_team.name, NEW.away_score, NEW.home_score, v_creator, NEW.scheduled_at)
    ON CONFLICT (event_id) DO UPDATE SET home_label = EXCLUDED.home_label, away_label = EXCLUDED.away_label,
      home_score = EXCLUDED.home_score, away_score = EXCLUDED.away_score, team_id = EXCLUDED.team_id, updated_at = now();
  END IF;

  RETURN NEW;
END;
$function$;