-- 1. Per-division hide-scores switch (must exist before policies reference it)
ALTER TABLE public.competition_divisions
  ADD COLUMN IF NOT EXISTS hide_scores boolean NOT NULL DEFAULT false;

-- 2. New scores table
CREATE TABLE public.competition_match_results (
  match_id uuid PRIMARY KEY REFERENCES public.competition_matches(id) ON DELETE CASCADE,
  home_score integer,
  away_score integer,
  entered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.competition_match_results TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.competition_match_results TO authenticated;
GRANT ALL ON public.competition_match_results TO service_role;

ALTER TABLE public.competition_match_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scores readable unless division hides them"
ON public.competition_match_results FOR SELECT
USING (
  NOT EXISTS (
    SELECT 1 FROM public.competition_matches m
    JOIN public.competition_divisions d ON d.id = m.division_id
    WHERE m.id = match_id AND d.hide_scores = true
  )
  OR public.is_competition_admin(auth.uid(), (
    SELECT m2.competition_id FROM public.competition_matches m2 WHERE m2.id = match_id
  ))
);

CREATE POLICY "comp admins enter scores"
ON public.competition_match_results FOR INSERT TO authenticated
WITH CHECK (public.is_competition_admin(auth.uid(), (
  SELECT m.competition_id FROM public.competition_matches m WHERE m.id = match_id
)));

CREATE POLICY "comp admins update scores"
ON public.competition_match_results FOR UPDATE TO authenticated
USING (public.is_competition_admin(auth.uid(), (
  SELECT m.competition_id FROM public.competition_matches m WHERE m.id = match_id
)))
WITH CHECK (public.is_competition_admin(auth.uid(), (
  SELECT m.competition_id FROM public.competition_matches m WHERE m.id = match_id
)));

CREATE POLICY "comp admins delete scores"
ON public.competition_match_results FOR DELETE TO authenticated
USING (public.is_competition_admin(auth.uid(), (
  SELECT m.competition_id FROM public.competition_matches m WHERE m.id = match_id
)));

CREATE TRIGGER update_competition_match_results_updated_at
BEFORE UPDATE ON public.competition_match_results
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Migrate existing scores
INSERT INTO public.competition_match_results (match_id, home_score, away_score)
SELECT id, home_score, away_score FROM public.competition_matches
WHERE home_score IS NOT NULL OR away_score IS NOT NULL;

-- 4. Drop the ladder view (depends on the columns being dropped)
DROP VIEW public.competition_ladder;

-- 5. Guard trigger: scores no longer live on the matches table
CREATE OR REPLACE FUNCTION public.guard_external_competition_match_edits()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  is_service boolean := (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role';
BEGIN
  IF NEW.source IS DISTINCT FROM 'manual' AND NOT is_service THEN
    IF NEW.manually_overridden_at IS NOT NULL AND OLD.manually_overridden_at IS NULL THEN
      RETURN NEW;
    END IF;
    IF OLD.manually_overridden_at IS NOT NULL THEN
      RETURN NEW;
    END IF;
    IF NEW.scheduled_at  IS DISTINCT FROM OLD.scheduled_at
    OR NEW.home_team_id  IS DISTINCT FROM OLD.home_team_id
    OR NEW.away_team_id  IS DISTINCT FROM OLD.away_team_id
    OR NEW.status        IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'This match is synced from % and cannot be edited directly. Set manually_overridden_at first to take local control.', NEW.source
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 6. Match->event sync: stop copying scores (handled by the results trigger now)
CREATE OR REPLACE FUNCTION public.sync_competition_match_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_home_team RECORD; v_away_team RECORD; v_comp RECORD;
  v_creator uuid; v_title text; v_cancelled boolean; v_description text;
  v_location text; v_location_name text; v_home_event uuid; v_away_event uuid;
  v_placeholder boolean; v_home_name text; v_away_name text;
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
        competition_match_id, competition_side, notify_suppressed
      ) VALUES (
        v_home_team.club_id, v_home_team.id, v_title, NEW.scheduled_at, 'game',
        v_away_name, true, v_location, v_location_name, v_description,
        v_creator, v_cancelled, NEW.id, 'home', v_placeholder
      ) RETURNING id INTO v_home_event;
    ELSE
      UPDATE public.events
         SET title = v_title, event_date = NEW.scheduled_at, team_id = v_home_team.id,
             club_id = v_home_team.club_id, opponent = v_away_name, location = v_location,
             location_name = v_location_name, description = v_description, is_cancelled = v_cancelled,
             is_home_game = true,
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
        competition_match_id, competition_side, notify_suppressed
      ) VALUES (
        v_away_team.club_id, v_away_team.id, v_title, NEW.scheduled_at, 'game',
        v_home_name, false, v_location, v_location_name, v_description,
        v_creator, v_cancelled, NEW.id, 'away', v_placeholder
      ) RETURNING id INTO v_away_event;
    ELSE
      UPDATE public.events
         SET title = v_title, event_date = NEW.scheduled_at, team_id = v_away_team.id,
             club_id = v_away_team.club_id, opponent = v_home_name, location = v_location,
             location_name = v_location_name, description = v_description, is_cancelled = v_cancelled,
             is_home_game = false,
             competition_match_id = NEW.id, competition_side = 'away'
       WHERE id = v_away_event;
    END IF;
    NEW.away_event_id := v_away_event;
  END IF;

  RETURN NEW;
END;
$$;

-- 7. Drop the score columns from the matches table
ALTER TABLE public.competition_matches DROP COLUMN home_score;
ALTER TABLE public.competition_matches DROP COLUMN away_score;

-- 8. Ladder view reads scores from the new table
CREATE VIEW public.competition_ladder AS
WITH per_team AS (
  SELECT m.competition_id,
         COALESCE(e.division_id, m.division_id) AS division_id,
         m.home_team_id AS team_id,
         1 AS played,
         CASE WHEN r.home_score > r.away_score THEN 1 ELSE 0 END AS wins,
         CASE WHEN r.home_score = r.away_score THEN 1 ELSE 0 END AS draws,
         CASE WHEN r.home_score < r.away_score THEN 1 ELSE 0 END AS losses,
         COALESCE(r.home_score, 0) AS goals_for,
         COALESCE(r.away_score, 0) AS goals_against
    FROM public.competition_matches m
    JOIN public.competition_match_results r ON r.match_id = m.id
    LEFT JOIN public.competition_entries e ON e.competition_id = m.competition_id AND e.team_id = m.home_team_id
   WHERE m.status = 'completed' AND r.home_score IS NOT NULL AND r.away_score IS NOT NULL AND m.home_team_id IS NOT NULL
  UNION ALL
  SELECT m.competition_id,
         COALESCE(e.division_id, m.division_id) AS division_id,
         m.away_team_id,
         1,
         CASE WHEN r.away_score > r.home_score THEN 1 ELSE 0 END,
         CASE WHEN r.away_score = r.home_score THEN 1 ELSE 0 END,
         CASE WHEN r.away_score < r.home_score THEN 1 ELSE 0 END,
         COALESCE(r.away_score, 0),
         COALESCE(r.home_score, 0)
    FROM public.competition_matches m
    JOIN public.competition_match_results r ON r.match_id = m.id
    LEFT JOIN public.competition_entries e ON e.competition_id = m.competition_id AND e.team_id = m.away_team_id
   WHERE m.status = 'completed' AND r.home_score IS NOT NULL AND r.away_score IS NOT NULL AND m.away_team_id IS NOT NULL
)
SELECT pt.competition_id,
       pt.division_id,
       pt.team_id,
       sum(pt.played)::integer AS played,
       sum(pt.wins)::integer AS wins,
       sum(pt.draws)::integer AS draws,
       sum(pt.losses)::integer AS losses,
       sum(pt.goals_for)::integer AS goals_for,
       sum(pt.goals_against)::integer AS goals_against,
       (sum(pt.goals_for) - sum(pt.goals_against))::integer AS goal_diff,
       ((sum(pt.wins) * COALESCE(max(c.points_win), 3)) + (sum(pt.draws) * COALESCE(max(c.points_draw), 1)) + (sum(pt.losses) * COALESCE(max(c.points_loss), 0)))::integer AS points
  FROM per_team pt
  JOIN public.competitions c ON c.id = pt.competition_id
 WHERE (public.is_competition_admin(auth.uid(), pt.competition_id)
    OR (NOT c.hide_ladder AND NOT EXISTS (
      SELECT 1 FROM public.competition_divisions hd
       WHERE hd.competition_id = pt.competition_id AND hd.hide_ladder = true)))
 GROUP BY pt.competition_id, pt.division_id, pt.team_id;

GRANT SELECT ON public.competition_ladder TO anon;
GRANT SELECT ON public.competition_ladder TO authenticated;
GRANT SELECT ON public.competition_ladder TO service_role;

-- 9. Results -> events/game_results propagation, honouring hide_scores
CREATE OR REPLACE FUNCTION public.sync_competition_result_to_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_match RECORD;
  v_hidden boolean;
  v_home_name text;
  v_away_name text;
BEGIN
  SELECT m.id, m.competition_id, m.division_id, m.home_team_id, m.away_team_id,
         m.scheduled_at, m.created_by, c.created_by AS comp_creator
    INTO v_match
    FROM public.competition_matches m
    JOIN public.competitions c ON c.id = m.competition_id
   WHERE m.id = NEW.match_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT COALESCE((
    SELECT d.hide_scores FROM public.competition_divisions d WHERE d.id = v_match.division_id
  ), false) INTO v_hidden;

  IF v_hidden OR NEW.home_score IS NULL OR NEW.away_score IS NULL THEN
    -- Hidden (or cleared) scores must not leak through schedule events or game results.
    UPDATE public.events SET final_score_home = NULL, final_score_away = NULL
     WHERE competition_match_id = NEW.match_id;
    UPDATE public.game_results gr SET home_score = NULL, away_score = NULL
      FROM public.events e
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
$$;

CREATE TRIGGER trg_sync_competition_result_events
AFTER INSERT OR UPDATE ON public.competition_match_results
FOR EACH ROW EXECUTE FUNCTION public.sync_competition_result_to_events();

-- 10. Toggling hide_scores re-syncs every result in the division
CREATE OR REPLACE FUNCTION public.resync_division_scores_on_hide_toggle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.hide_scores IS DISTINCT FROM OLD.hide_scores THEN
    UPDATE public.competition_match_results r SET updated_at = now()
      FROM public.competition_matches m
     WHERE r.match_id = m.id AND m.division_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_resync_division_scores
AFTER UPDATE OF hide_scores ON public.competition_divisions
FOR EACH ROW EXECUTE FUNCTION public.resync_division_scores_on_hide_toggle();