CREATE OR REPLACE FUNCTION public.on_event_updated()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  request_id bigint;
  changed_fields jsonb := '[]'::jsonb;
  base_url text;
  svc_key text;
BEGIN
  IF current_setting('ignite.skip_event_update_notify', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.is_cancelled = true OR NEW.parent_event_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.event_date IS DISTINCT FROM NEW.event_date THEN
    changed_fields := changed_fields || jsonb_build_object('field', 'date', 'old', OLD.event_date, 'new', NEW.event_date);
  END IF;
  IF OLD.start_time IS DISTINCT FROM NEW.start_time THEN
    changed_fields := changed_fields || jsonb_build_object('field', 'start_time', 'old', OLD.start_time, 'new', NEW.start_time);
  END IF;
  IF OLD.meet_time IS DISTINCT FROM NEW.meet_time THEN
    changed_fields := changed_fields || jsonb_build_object('field', 'meet_time', 'old', OLD.meet_time, 'new', NEW.meet_time);
  END IF;
  IF OLD.location IS DISTINCT FROM NEW.location THEN
    changed_fields := changed_fields || jsonb_build_object('field', 'location', 'old', OLD.location, 'new', NEW.location);
  END IF;
  IF OLD.address IS DISTINCT FROM NEW.address THEN
    changed_fields := changed_fields || jsonb_build_object('field', 'address', 'old', OLD.address, 'new', NEW.address);
  END IF;
  IF OLD.title IS DISTINCT FROM NEW.title THEN
    changed_fields := changed_fields || jsonb_build_object('field', 'title', 'old', OLD.title, 'new', NEW.title);
  END IF;
  IF OLD.opponent IS DISTINCT FROM NEW.opponent THEN
    changed_fields := changed_fields || jsonb_build_object('field', 'opponent', 'old', OLD.opponent, 'new', NEW.opponent);
  END IF;
  IF jsonb_array_length(changed_fields) = 0 THEN
    RETURN NEW;
  END IF;
  base_url := public.internal_functions_base_url();
  svc_key := public.internal_service_role_key();
  IF base_url IS NULL OR svc_key IS NULL THEN
    RAISE WARNING 'Event update notification dispatch skipped for event %: missing vault secret', NEW.id;
    RETURN NEW;
  END IF;
  SELECT net.http_post(
    url := base_url || '/functions/v1/process-event-notifications',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || svc_key),
    body := jsonb_build_object('action', 'event_updated', 'eventId', NEW.id, 'changedFields', changed_fields)
  ) INTO request_id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Async event update notification dispatch failed for event %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_competition_event_titles_on_team_rename()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.name IS NOT DISTINCT FROM OLD.name THEN
    RETURN NEW;
  END IF;
  PERFORM set_config('ignite.skip_event_update_notify', 'on', true);

  UPDATE public.events e
     SET title = CASE WHEN m.round_number IS NOT NULL THEN 'R' || m.round_number || ': ' ELSE '' END
                 || ht.name || ' vs ' || at.name,
         opponent = CASE WHEN e.opponent = OLD.name THEN NEW.name ELSE e.opponent END
    FROM public.competition_matches m
    JOIN public.teams ht ON ht.id = m.home_team_id
    JOIN public.teams at ON at.id = m.away_team_id
   WHERE (m.home_team_id = NEW.id OR m.away_team_id = NEW.id)
     AND (e.competition_match_id = m.id OR e.id IN (m.home_event_id, m.away_event_id));

  PERFORM set_config('ignite.skip_event_update_notify', 'off', true);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_refresh_competition_event_titles ON public.teams;
CREATE TRIGGER trg_refresh_competition_event_titles
AFTER UPDATE OF name ON public.teams
FOR EACH ROW EXECUTE FUNCTION public.refresh_competition_event_titles_on_team_rename();