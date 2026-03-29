
CREATE OR REPLACE FUNCTION public.on_event_updated()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  request_id bigint;
  changed_fields jsonb := '[]'::jsonb;
BEGIN
  -- Only fire for non-cancelled, non-child-recurring events
  IF NEW.is_cancelled = true OR NEW.parent_event_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Detect which high/medium impact fields changed
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

  -- Only fire if at least one tracked field changed
  IF jsonb_array_length(changed_fields) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/process-event-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as'
    ),
    body := jsonb_build_object(
      'action', 'event_updated',
      'eventId', NEW.id,
      'clubId', NEW.club_id,
      'teamId', NEW.team_id,
      'miniLeagueId', NEW.mini_league_id,
      'createdBy', NEW.created_by,
      'title', COALESCE(NEW.title, 'an event'),
      'changedFields', changed_fields
    )
  ) INTO request_id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Async event update notification dispatch failed for event %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

-- Create the trigger (drop first if exists to be safe)
DROP TRIGGER IF EXISTS on_event_updated_trigger ON public.events;
CREATE TRIGGER on_event_updated_trigger
  AFTER UPDATE ON public.events
  FOR EACH ROW
  WHEN (OLD.is_cancelled = false)
  EXECUTE FUNCTION public.on_event_updated();
