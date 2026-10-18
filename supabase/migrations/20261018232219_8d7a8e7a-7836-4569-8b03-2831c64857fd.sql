CREATE OR REPLACE FUNCTION public.sync_competition_result_to_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_match RECORD;
  v_hidden boolean;
  v_home_name text;
  v_away_name text;
BEGIN
  SELECT m.id, m.competition_id, m.division_id, m.home_team_id, m.away_team_id,
         m.scheduled_at, m.created_by, c.created_by AS comp_creator,
         c.hide_scores AS comp_hide_scores
    INTO v_match
    FROM public.competition_matches m
    JOIN public.competitions c ON c.id = m.competition_id
   WHERE m.id = NEW.match_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT (v_match.comp_hide_scores = true) OR COALESCE((
    SELECT d.hide_scores FROM public.competition_divisions d WHERE d.id = v_match.division_id
  ), false) INTO v_hidden;

  IF v_hidden OR NEW.home_score IS NULL OR NEW.away_score IS NULL THEN
    -- Hidden (or cleared) scores must not leak through schedule events or game results.
    UPDATE public.events SET final_score_home = NULL, final_score_away = NULL
     WHERE competition_match_id = NEW.match_id;
    DELETE FROM public.game_results gr
      USING public.events e
     WHERE gr.event_id = e.id AND e.competition_match_id = NEW.match_id;
    RETURN NEW;
  END IF;

  UPDATE public.events SET final_score_home = NEW.home_score, final_score_away = NEW.away_score
   WHERE competition_match_id = NEW.match_id;

  SELECT name INTO v_home_name FROM public.teams WHERE id = v_match.home_team_id;
  SELECT name INTO v_away_name FROM public.teams WHERE id = v_match.away_team_id;
  IF v_home_name IS NULL OR v_away_name IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.game_results (team_id, event_id, sport, home_label, away_label, home_score, away_score, saved_by, played_at)
  SELECT v_match.home_team_id, e.id, 'soccer', v_home_name, v_away_name, NEW.home_score, NEW.away_score,
         COALESCE(NEW.entered_by, v_match.created_by, v_match.comp_creator), v_match.scheduled_at
    FROM public.events e
   WHERE e.competition_match_id = NEW.match_id AND e.competition_side = 'home'
  ON CONFLICT (event_id) DO UPDATE SET home_label = EXCLUDED.home_label, away_label = EXCLUDED.away_label,
    home_score = EXCLUDED.home_score, away_score = EXCLUDED.away_score, updated_at = now();

  INSERT INTO public.game_results (team_id, event_id, sport, home_label, away_label, home_score, away_score, saved_by, played_at)
  SELECT v_match.away_team_id, e.id, 'soccer', v_away_name, v_home_name, NEW.away_score, NEW.home_score,
         COALESCE(NEW.entered_by, v_match.created_by, v_match.comp_creator), v_match.scheduled_at
    FROM public.events e
   WHERE e.competition_match_id = NEW.match_id AND e.competition_side = 'away'
  ON CONFLICT (event_id) DO UPDATE SET home_label = EXCLUDED.home_label, away_label = EXCLUDED.away_label,
    home_score = EXCLUDED.home_score, away_score = EXCLUDED.away_score, updated_at = now();

  RETURN NEW;
END;
$function$;