CREATE OR REPLACE FUNCTION public.on_event_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  request_id bigint;
  base_url text;
  svc_key text;
BEGIN
  -- Recurring child instances are covered by the parent dispatch.
  IF NEW.parent_event_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Never notify about an already-cancelled or historical event.
  IF COALESCE(NEW.is_cancelled, false) THEN
    RETURN NEW;
  END IF;

  IF NEW.event_date IS NOT NULL AND NEW.event_date::date < current_date THEN
    RETURN NEW;
  END IF;

  base_url := public.internal_functions_base_url();
  svc_key := public.internal_service_role_key();
  IF base_url IS NULL OR svc_key IS NULL THEN
    RAISE WARNING 'Event notification dispatch skipped for event %: missing functions_base_url/service_role_key vault secret', NEW.id;
    RETURN NEW;
  END IF;

  SELECT net.http_post(
    url := base_url || '/functions/v1/process-event-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || svc_key
    ),
    body := jsonb_build_object(
      'action', 'event_created',
      'eventId', NEW.id
    )
  ) INTO request_id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Async event notification dispatch failed for event %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;