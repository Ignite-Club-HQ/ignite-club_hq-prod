-- Ensure pg_cron available (already enabled on this project, but safe to re-run).
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Helper function: prunes diagnostic log tables older than 30 days.
CREATE OR REPLACE FUNCTION public.prune_old_diagnostic_logs()
RETURNS TABLE(push_logs_deleted bigint, activity_logs_deleted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_push_deleted bigint := 0;
  v_activity_deleted bigint := 0;
BEGIN
  -- Delete in batches to avoid long locks. Loop until no rows remain >30d.
  LOOP
    WITH d AS (
      DELETE FROM public.push_notification_logs
      WHERE ctid IN (
        SELECT ctid FROM public.push_notification_logs
        WHERE created_at < now() - interval '30 days'
        LIMIT 5000
      )
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_push_deleted FROM d;
    EXIT WHEN v_push_deleted = 0;
    push_logs_deleted := COALESCE(push_logs_deleted, 0) + v_push_deleted;
  END LOOP;

  LOOP
    WITH d AS (
      DELETE FROM public.user_activity_logs
      WHERE ctid IN (
        SELECT ctid FROM public.user_activity_logs
        WHERE created_at < now() - interval '30 days'
        LIMIT 5000
      )
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_activity_deleted FROM d;
    EXIT WHEN v_activity_deleted = 0;
    activity_logs_deleted := COALESCE(activity_logs_deleted, 0) + v_activity_deleted;
  END LOOP;

  push_logs_deleted := COALESCE(push_logs_deleted, 0);
  activity_logs_deleted := COALESCE(activity_logs_deleted, 0);
  RETURN NEXT;
END;
$$;

-- Lock down execution: only the cron owner / service role should call it.
REVOKE ALL ON FUNCTION public.prune_old_diagnostic_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_old_diagnostic_logs() TO service_role;

-- Helpful indexes for the WHERE clause (and any future analytics windowing).
CREATE INDEX IF NOT EXISTS idx_push_notification_logs_created_at ON public.push_notification_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_created_at ON public.user_activity_logs(created_at);

-- Schedule nightly at 03:15 UTC. Unschedule any prior copy first so this migration is idempotent.
DO $$
DECLARE
  jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'prune-old-diagnostic-logs';
  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
END $$;

SELECT cron.schedule(
  'prune-old-diagnostic-logs',
  '15 3 * * *',
  $$SELECT public.prune_old_diagnostic_logs();$$
);