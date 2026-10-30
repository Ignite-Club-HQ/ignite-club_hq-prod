-- 1) Skip creating team games for fixtures while the competition is in draft
DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.sync_competition_match_events'::regproc);
  d := replace(d,
    'SELECT id, name, created_by INTO v_comp FROM public.competitions WHERE id = NEW.competition_id;',
    'SELECT id, name, created_by, status INTO v_comp FROM public.competitions WHERE id = NEW.competition_id;

  -- Draft competitions: keep fixtures private. Only keep already-created games in sync.
  IF v_comp.status = ''draft''
     AND NEW.home_event_id IS NULL AND NEW.away_event_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.events WHERE competition_match_id = NEW.id) THEN
    RETURN NEW;
  END IF;');
  IF position('v_comp.status = ''draft''' in d) = 0 THEN
    RAISE EXCEPTION 'sync_competition_match_events patch failed';
  END IF;
  EXECUTE d;

  -- 2) Allow bulk publish to suppress per-game "new event" alerts
  d := pg_get_functiondef('public.on_event_created'::regproc);
  d := replace(d,
    '-- Recurring child instances are covered by the parent dispatch.',
    'IF current_setting(''ignite.suppress_event_notify'', true) = ''on'' THEN
    RETURN NEW;
  END IF;

  -- Recurring child instances are covered by the parent dispatch.');
  IF position('ignite.suppress_event_notify' in d) = 0 THEN
    RAISE EXCEPTION 'on_event_created patch failed';
  END IF;
  EXECUTE d;
END
$do$;

-- 3) On publish: create all team games at once and send one alert per team
CREATE OR REPLACE FUNCTION public.tg_competition_publish_fixtures()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  IF NOT (OLD.status = 'draft' AND NEW.status IS DISTINCT FROM 'draft') THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('ignite.suppress_event_notify', 'on', true);

  UPDATE public.competition_matches
     SET updated_at = now()
   WHERE competition_id = NEW.id
     AND scheduled_at IS NOT NULL
     AND home_team_id IS NOT NULL
     AND away_team_id IS NOT NULL;

  PERFORM set_config('ignite.suppress_event_notify', 'off', true);

  FOR r IN
    SELECT e.team_id, t.name AS team_name, t.club_id,
           count(*) AS games,
           (array_agg(e.id ORDER BY e.event_date))[1] AS first_event
      FROM public.events e
      JOIN public.competition_matches m ON m.id = e.competition_match_id
      JOIN public.teams t ON t.id = e.team_id
     WHERE m.competition_id = NEW.id
       AND COALESCE(e.is_cancelled, false) = false
       AND e.event_date >= now()
     GROUP BY e.team_id, t.name, t.club_id
  LOOP
    INSERT INTO public.notifications (user_id, type, message, related_id, club_id, dedupe_key)
    SELECT DISTINCT ur.user_id, 'event_invite',
           NEW.name || ' fixtures are out — ' || r.games || ' game' ||
             CASE WHEN r.games = 1 THEN '' ELSE 's' END ||
             ' added to ' || r.team_name || '''s schedule',
           r.first_event, r.club_id,
           'comp_publish:' || NEW.id::text || ':' || r.team_id::text || ':' || ur.user_id::text
      FROM public.user_roles ur
     WHERE ur.team_id = r.team_id
       AND ur.user_id IS NOT NULL
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_competition_publish_fixtures() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_competition_publish_fixtures ON public.competitions;
CREATE TRIGGER trg_competition_publish_fixtures
AFTER UPDATE OF status ON public.competitions
FOR EACH ROW EXECUTE FUNCTION public.tg_competition_publish_fixtures();