-- Capacity telemetry hardening
--
-- 1. Web-vital rows are global operational telemetry and have no club_id.
--    Restrict reads to app admins rather than exposing cross-club user/device
--    metadata to every club admin.
-- 2. Provide one bounded-retention operation for all client telemetry tables.
--    Scheduling is deliberately left to the hosted project's controlled cron
--    configuration; this migration does not create or change a cron job.

DROP POLICY IF EXISTS "Admins can read vitals" ON public.web_vitals;
DROP POLICY IF EXISTS "App admins can read vitals" ON public.web_vitals;

CREATE POLICY "App admins can read vitals"
  ON public.web_vitals
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'app_admin'::app_role));

CREATE OR REPLACE FUNCTION public.purge_old_capacity_telemetry(
  retention_days integer DEFAULT 30
)
RETURNS TABLE (
  client_perf_deleted bigint,
  realtime_perf_deleted bigint,
  web_vitals_deleted bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cutoff timestamptz;
BEGIN
  IF retention_days < 7 OR retention_days > 365 THEN
    RAISE EXCEPTION 'retention_days must be between 7 and 365';
  END IF;

  cutoff := now() - make_interval(days => retention_days);

  DELETE FROM public.client_perf_log WHERE created_at < cutoff;
  GET DIAGNOSTICS client_perf_deleted = ROW_COUNT;

  DELETE FROM public.realtime_perf_samples WHERE created_at < cutoff;
  GET DIAGNOSTICS realtime_perf_deleted = ROW_COUNT;

  DELETE FROM public.web_vitals WHERE created_at < cutoff;
  GET DIAGNOSTICS web_vitals_deleted = ROW_COUNT;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_old_capacity_telemetry(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_old_capacity_telemetry(integer) FROM anon;
REVOKE ALL ON FUNCTION public.purge_old_capacity_telemetry(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_capacity_telemetry(integer) TO service_role;
