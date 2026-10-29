-- DEV-only compatibility migration (ecsdwrarzfexssxtrymj). Source: integration-hybrid 70d821c8,
-- migrations 20261008014417, 20261022030115, 20261021003048/003143, 20261014010000 and
-- docs/competition-history-preservation-layer.sql (read_competition_playhq), adapted to DEV's existing
-- score-separation schema (events.competition_match_id linkage; no game_results/events history columns).

-- 1. Columns
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS home_country text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='clubs_home_country_check' AND conrelid='public.clubs'::regclass) THEN
    ALTER TABLE public.clubs ADD CONSTRAINT clubs_home_country_check CHECK (home_country IS NULL OR home_country ~ '^[A-Z]{2}$');
  END IF;
END $$;
ALTER TABLE public.club_subscriptions ADD COLUMN IF NOT EXISTS pricing_version text NOT NULL DEFAULT 'legacy';

-- 2. Helpers
CREATE OR REPLACE FUNCTION public.can_manage_competition_vault(_competition_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND public.is_competition_admin(auth.uid(), _competition_id)
$$;

CREATE OR REPLACE FUNCTION public.competition_scores_visible(match_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.competition_matches m
    WHERE m.id = competition_scores_visible.match_id
      AND public.can_view_competition(auth.uid(), m.competition_id)
      AND (public.can_manage_competition_vault(m.competition_id) OR NOT public.match_scores_hidden(m.id))
  )
$$;

CREATE OR REPLACE FUNCTION public.history_scores_visible(p_event uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE WHEN p_event IS NULL THEN true ELSE coalesce((
    SELECT CASE WHEN e.competition_match_id IS NULL THEN true
                ELSE public.competition_scores_visible(e.competition_match_id) END
    FROM public.events e WHERE e.id = p_event), false) END
$$;

CREATE OR REPLACE FUNCTION public.can_read_history_row(p_team uuid, p_event uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL
    AND (p_event IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event AND e.team_id = p_team))
    AND CASE WHEN p_event IS NOT NULL THEN public.can_access_targeted_event(auth.uid(), p_event)
             ELSE public.can_manage_game_result(auth.uid(), p_team, NULL)
                  OR EXISTS (SELECT 1 FROM public.teams t WHERE t.id = p_team AND public.is_club_member(auth.uid(), t.club_id)) END
$$;

CREATE OR REPLACE FUNCTION public.mask_history_players(p_players jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT coalesce(jsonb_agg(safe), '[]'::jsonb) FROM (
    SELECT coalesce(jsonb_object_agg(k, v) FILTER (WHERE k IN ('id','name','secondsPlayed','finalPosition','fouls','isFouledOut','isInjured','yellow','red','award') AND jsonb_typeof(v) NOT IN ('array','object')), '{}'::jsonb) safe
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_players)='array' THEN p_players ELSE '[]'::jsonb END) WITH ORDINALITY AS player(value, position)
    LEFT JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(player.value)='object' THEN player.value ELSE '{}'::jsonb END) AS fields(k, v) ON true
    GROUP BY player.position ORDER BY player.position) bounded
$$;

CREATE OR REPLACE FUNCTION public.history_result_dto(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object(
    'id', g.id, 'team_id', g.team_id, 'event_id', g.event_id, 'sport', g.sport,
    'home_label', g.home_label, 'away_label', g.away_label, 'played_at', g.played_at, 'saved_by', g.saved_by,
    'home_score', CASE WHEN v.visible THEN coalesce(CASE WHEN e.competition_side='away' THEN r.away_score ELSE r.home_score END, g.home_score) END,
    'away_score', CASE WHEN v.visible THEN coalesce(CASE WHEN e.competition_side='away' THEN r.home_score ELSE r.away_score END, g.away_score) END,
    'scores_hidden', NOT v.visible,
    'period_scores', CASE WHEN v.visible THEN g.period_scores ELSE '[]'::jsonb END,
    'player_stats', CASE WHEN v.visible THEN g.player_stats ELSE public.mask_history_players(g.player_stats) END,
    'mvp_player_id', g.mvp_player_id, 'mvp_player_name', g.mvp_player_name,
    'notes', CASE WHEN v.visible THEN g.notes END,
    'events', CASE WHEN e.id IS NOT NULL THEN jsonb_build_object('id', e.id, 'title', e.title, 'start_time', e.start_time) END,
    'teams', jsonb_build_object('id', t.id, 'name', t.name))
  FROM public.game_results g
  JOIN public.teams t ON t.id = g.team_id
  LEFT JOIN public.events e ON e.id = g.event_id
  LEFT JOIN public.competition_matches m ON m.id = e.competition_match_id
  LEFT JOIN public.competition_match_results r ON r.match_id = e.competition_match_id
  CROSS JOIN LATERAL (SELECT CASE WHEN e.competition_match_id IS NULL THEN true
      ELSE coalesce(public.can_manage_competition_vault(m.competition_id), false) OR public.competition_scores_visible(e.competition_match_id) END AS visible) v
  WHERE g.id = p_id
    AND (public.can_read_history_row(g.team_id, g.event_id)
         OR (m.competition_id IS NOT NULL AND public.can_manage_competition_vault(m.competition_id)))
$$;

-- 3. Public RPCs (names, arguments, defaults and return shapes match hybrid)
CREATE OR REPLACE FUNCTION public.read_game_result(p_event_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.history_result_dto(g.id) FROM public.game_results g WHERE g.event_id = p_event_id
$$;

CREATE OR REPLACE FUNCTION public.read_game_history(p_team_id uuid DEFAULT NULL, p_club_id uuid DEFAULT NULL, p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce(jsonb_agg(dto ORDER BY played_at DESC), '[]'::jsonb) FROM (
    SELECT g.played_at, public.history_result_dto(g.id) dto
    FROM public.game_results g JOIN public.teams t ON t.id = g.team_id
    WHERE (p_team_id IS NOT NULL OR p_club_id IS NOT NULL)
      AND (p_team_id IS NULL OR g.team_id = p_team_id)
      AND (p_club_id IS NULL OR t.club_id = p_club_id)
    ORDER BY g.played_at DESC) scoped
  WHERE dto IS NOT NULL
  -- bounded below
$$;
-- Re-define with the hybrid limit bound applied after access filtering.
CREATE OR REPLACE FUNCTION public.read_game_history(p_team_id uuid DEFAULT NULL, p_club_id uuid DEFAULT NULL, p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce(jsonb_agg(dto ORDER BY played_at DESC), '[]'::jsonb) FROM (
    SELECT played_at, dto FROM (
      SELECT g.played_at, public.history_result_dto(g.id) dto
      FROM public.game_results g JOIN public.teams t ON t.id = g.team_id
      WHERE (p_team_id IS NOT NULL OR p_club_id IS NOT NULL)
        AND (p_team_id IS NULL OR g.team_id = p_team_id)
        AND (p_club_id IS NULL OR t.club_id = p_club_id)) s
    WHERE dto IS NOT NULL
    ORDER BY played_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 100), 100))) bounded
$$;

CREATE OR REPLACE FUNCTION public.save_game_history(p_result jsonb, p_only_if_missing boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  uid uuid := auth.uid();
  team uuid := nullif(p_result->>'team_id','')::uuid;
  event uuid := nullif(p_result->>'event_id','')::uuid;
  e public.events%ROWTYPE;
  comp uuid;
  h integer := (p_result->>'home_score')::integer;
  a integer := (p_result->>'away_score')::integer;
BEGIN
  IF uid IS NULL OR team IS NULL OR h IS NULL OR a IS NULL OR h < 0 OR a < 0 THEN
    RAISE EXCEPTION 'Invalid game result' USING ERRCODE='22023';
  END IF;
  IF event IS NOT NULL THEN
    SELECT * INTO e FROM public.events WHERE id = event FOR UPDATE;
    IF NOT FOUND OR e.team_id IS DISTINCT FROM team THEN RAISE EXCEPTION 'Event/team mismatch' USING ERRCODE='42501'; END IF;
    IF e.competition_match_id IS NOT NULL THEN
      SELECT competition_id INTO comp FROM public.competition_matches WHERE id = e.competition_match_id FOR UPDATE;
      IF comp IS NULL OR NOT public.can_manage_competition_vault(comp) THEN
        RAISE EXCEPTION 'Competition manager required' USING ERRCODE='42501';
      END IF;
    END IF;
  END IF;
  IF comp IS NULL AND NOT public.can_manage_game_result(uid, team, event) THEN
    RAISE EXCEPTION 'Game management forbidden' USING ERRCODE='42501';
  END IF;
  IF p_only_if_missing AND event IS NOT NULL AND EXISTS (SELECT 1 FROM public.game_results WHERE event_id = event) THEN RETURN; END IF;
  IF comp IS NOT NULL THEN
    INSERT INTO public.competition_match_results(match_id, home_score, away_score, entered_by)
    VALUES (e.competition_match_id,
            CASE WHEN e.competition_side='away' THEN a ELSE h END,
            CASE WHEN e.competition_side='away' THEN h ELSE a END, uid)
    ON CONFLICT (match_id) DO UPDATE SET home_score=excluded.home_score, away_score=excluded.away_score, entered_by=uid;
    UPDATE public.competition_matches
       SET status='completed',
           manually_overridden_at = CASE WHEN source <> 'manual' THEN coalesce(manually_overridden_at, now()) ELSE manually_overridden_at END
     WHERE id = e.competition_match_id;
    -- DEV keeps hidden competition scores out of game_results entirely (sync trigger deletes them).
    IF public.match_scores_hidden(e.competition_match_id) THEN RETURN; END IF;
  END IF;
  INSERT INTO public.game_results(team_id, event_id, sport, home_label, away_label, home_score, away_score,
                                  period_scores, player_stats, mvp_player_id, mvp_player_name, notes, saved_by)
  VALUES (team, event, p_result->>'sport', p_result->>'home_label', p_result->>'away_label', h, a,
          coalesce(p_result->'period_scores','[]'), coalesce(p_result->'player_stats','[]'),
          p_result->>'mvp_player_id', p_result->>'mvp_player_name', p_result->>'notes', uid)
  ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO UPDATE SET
    home_score=excluded.home_score, away_score=excluded.away_score, period_scores=excluded.period_scores,
    player_stats=excluded.player_stats, mvp_player_id=excluded.mvp_player_id,
    mvp_player_name=excluded.mvp_player_name, notes=excluded.notes;
END $$;

CREATE OR REPLACE FUNCTION public.read_history_player_stats(p_team_id uuid, p_event_id uuid DEFAULT NULL, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce(jsonb_agg(dto), '[]'::jsonb) FROM (
    SELECT (to_jsonb(s) - 'goals_scored' - 'assists') || jsonb_build_object(
      'goals_scored', CASE WHEN public.history_scores_visible(e.id) THEN s.goals_scored END,
      'assists', CASE WHEN public.history_scores_visible(e.id) THEN s.assists END,
      'profiles', CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('display_name', p.display_name, 'avatar_url', p.avatar_url) END) dto
    FROM public.game_player_stats s JOIN public.events e ON e.id = s.event_id
    LEFT JOIN public.profiles p ON p.id = s.user_id
    WHERE s.team_id = p_team_id AND e.team_id = p_team_id AND public.can_read_history_row(e.team_id, e.id)
      AND (p_event_id IS NULL OR e.id = p_event_id)
      AND (p_from IS NULL OR e.event_date >= p_from) AND (p_to IS NULL OR e.event_date <= p_to)
    ORDER BY e.event_date DESC LIMIT 1000) bounded
$$;

CREATE OR REPLACE FUNCTION public.read_history_summary(p_event_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object('id', s.id, 'event_id', s.event_id, 'team_id', s.team_id, 'total_game_time', s.total_game_time,
    'half_duration', s.half_duration, 'total_substitutions', s.total_substitutions, 'formation_used', s.formation_used)
  FROM public.game_summaries s JOIN public.events e ON e.id = s.event_id
  WHERE s.team_id = e.team_id AND e.id = p_event_id AND public.can_read_history_row(e.team_id, e.id)
$$;

CREATE OR REPLACE FUNCTION public.read_history_report_events(p_team_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) FROM (
    SELECT e.id, e.title, e.event_date, e.opponent FROM public.events e
    WHERE e.team_id = p_team_id AND e.type = 'game' AND public.can_read_history_row(e.team_id, e.id)
      AND (EXISTS (SELECT 1 FROM public.game_summaries s WHERE s.event_id = e.id)
        OR EXISTS (SELECT 1 FROM public.game_player_stats s WHERE s.event_id = e.id)
        OR EXISTS (SELECT 1 FROM public.game_results r WHERE r.event_id = e.id))
    ORDER BY e.event_date DESC LIMIT 100) row
$$;

CREATE OR REPLACE FUNCTION public.save_competition_match_result(p_match_id uuid, p_home_score integer, p_away_score integer, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE target public.competition_matches%ROWTYPE;
BEGIN
  SELECT * INTO target FROM public.competition_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_competition_vault(target.competition_id) THEN
    RAISE EXCEPTION 'Competition manager required' USING ERRCODE='42501';
  END IF;
  IF p_home_score IS NULL OR p_away_score IS NULL OR p_home_score < 0 OR p_away_score < 0
     OR p_status NOT IN ('scheduled','completed','cancelled','postponed') THEN
    RAISE EXCEPTION 'Invalid result' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.competition_match_results(match_id, home_score, away_score, entered_by)
  VALUES (p_match_id, p_home_score, p_away_score, auth.uid())
  ON CONFLICT (match_id) DO UPDATE SET home_score=excluded.home_score, away_score=excluded.away_score, entered_by=auth.uid();
  UPDATE public.competition_matches
     SET status = coalesce(p_status, target.status),
         manually_overridden_at = CASE WHEN source <> 'manual' THEN coalesce(manually_overridden_at, now()) ELSE manually_overridden_at END
   WHERE id = p_match_id;
END $$;

CREATE OR REPLACE FUNCTION public.get_my_viewable_competition_match_ids()
RETURNS TABLE (match_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT cm.id FROM public.competition_matches cm
  JOIN public.competitions competition ON competition.id = cm.competition_id
  WHERE auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.competition_roles cr
            WHERE cr.competition_id = competition.id AND cr.user_id = auth.uid() AND cr.role IN ('owner','admin'))
    OR EXISTS (SELECT 1 FROM public.user_roles ur
               WHERE ur.club_id = competition.organizer_club_id AND ur.user_id = auth.uid() AND ur.role = 'league_admin'))
$$;

CREATE OR REPLACE FUNCTION public.read_competition_playhq(p_competition_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object(
    'matches', coalesce((SELECT jsonb_agg(jsonb_build_object('tenant', coalesce(c.external_tenant,'default'), 'external_id', m.external_id,
        'external_home_team_id', m.external_home_team_id, 'external_away_team_id', m.external_away_team_id,
        'home_team_name', m.home_team_name, 'away_team_name', m.away_team_name, 'division_id', m.division_id,
        'competition_divisions', jsonb_build_object('name', d.name)))
      FROM public.competition_matches m LEFT JOIN public.competition_divisions d ON d.id = m.division_id
      WHERE m.competition_id = p_competition_id AND m.source = 'playhq'), '[]'::jsonb),
    'stats', coalesce((SELECT jsonb_agg(jsonb_build_object('playhq_game_id', s.playhq_game_id, 'playhq_team_id', s.playhq_team_id,
        'playhq_player_id', s.playhq_player_id, 'player_name', s.player_name, 'stats', s.stats, 'tenant', coalesce(c.external_tenant,'default')))
      FROM public.playhq_player_stats s JOIN public.competition_matches m ON m.external_id = s.playhq_game_id AND m.source = 'playhq'
      WHERE m.competition_id = c.id AND public.competition_scores_visible(m.id)), '[]'::jsonb),
    'links', coalesce((SELECT jsonb_agg(jsonb_build_object('playhq_player_id', l.playhq_player_id, 'mine', true, 'tenant', l.tenant))
      FROM public.playhq_player_links l
      WHERE l.user_id = auth.uid() AND l.tenant = coalesce(c.external_tenant,'default')
        AND EXISTS (SELECT 1 FROM public.playhq_player_stats s JOIN public.competition_matches m ON m.external_id = s.playhq_game_id
                    WHERE m.competition_id = c.id AND s.playhq_player_id = l.playhq_player_id AND public.competition_scores_visible(m.id))), '[]'::jsonb))
  FROM public.competitions c
  WHERE c.id = p_competition_id AND public.can_view_competition(auth.uid(), c.id)
$$;

-- 4. EXECUTE grants: revoke Supabase defaults, grant signed-in callers only.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN (
    'can_manage_competition_vault','competition_scores_visible','history_scores_visible','can_read_history_row','mask_history_players',
    'history_result_dto','read_game_result','read_game_history','save_game_history','read_history_player_stats','read_history_summary',
    'read_history_report_events','save_competition_match_result','get_my_viewable_competition_match_ids','read_competition_playhq')
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig); END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.can_manage_competition_vault(uuid), public.competition_scores_visible(uuid),
  public.history_scores_visible(uuid), public.can_read_history_row(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.read_game_result(uuid), public.read_game_history(uuid,uuid,integer),
  public.save_game_history(jsonb,boolean), public.read_history_player_stats(uuid,uuid,timestamptz,timestamptz),
  public.read_history_summary(uuid), public.read_history_report_events(uuid),
  public.save_competition_match_result(uuid,integer,integer,text), public.get_my_viewable_competition_match_ids(),
  public.read_competition_playhq(uuid) TO authenticated;