CREATE OR REPLACE FUNCTION public.default_competition_event_reminder()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.competition_match_id IS NOT NULL AND NEW.reminder_hours_before IS NULL THEN
    NEW.reminder_hours_before := 24;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_default_competition_event_reminder ON public.events;
CREATE TRIGGER trg_default_competition_event_reminder
BEFORE INSERT ON public.events
FOR EACH ROW EXECUTE FUNCTION public.default_competition_event_reminder();

UPDATE public.events
   SET reminder_hours_before = 24
 WHERE competition_match_id IS NOT NULL
   AND reminder_hours_before IS NULL
   AND event_date > now()
   AND is_cancelled = false;

SELECT cron.schedule(
  'send-event-reminders-hourly',
  '0 * * * *',
  $cron$
  SELECT net.http_post(
    url := public.internal_functions_base_url() || '/functions/v1/send-event-reminders',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || public.internal_service_role_key()),
    body := jsonb_build_object('source','cron'),
    timeout_milliseconds := 25000
  )
  WHERE public.internal_functions_base_url() IS NOT NULL
    AND public.internal_service_role_key() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.events e
       WHERE e.reminder_sent = false AND e.is_cancelled = false
         AND e.reminder_hours_before IS NOT NULL
         AND e.event_date > now()
         AND now() >= e.event_date - make_interval(hours => e.reminder_hours_before)
    );
  $cron$
);