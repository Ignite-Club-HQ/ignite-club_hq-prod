-- REVIEW / LOCAL REHEARSAL ONLY. Preserve deployed validator and its sole trigger.
-- No shell/lifecycle expansion, historical revalidation or duplicate trigger.
DO $$ BEGIN
 IF to_regprocedure('public.validate_event_duty_team()') IS NULL THEN RAISE EXCEPTION 'Expected duty validator missing'; END IF;
 IF (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.events'::regclass AND NOT tgisinternal
     AND tgfoid='public.validate_event_duty_team()'::regprocedure) <> 1 THEN
   RAISE EXCEPTION 'Expected exactly one duty validator trigger';
 END IF;
END; $$;