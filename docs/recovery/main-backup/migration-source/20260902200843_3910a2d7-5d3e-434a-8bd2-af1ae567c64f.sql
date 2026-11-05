-- Ongoing retention for cron.job_run_details (14 days).
-- Deliberately does NOT prune the whole existing backlog: MAX work per call is
-- capped, so deployment is cheap and repeated invocations converge over time.
CREATE OR REPLACE FUNCTION public.prune_cron_run_history(
  p_retain_days integer DEFAULT 14,
  p_batch_size integer DEFAULT 5000,
  p_max_batches integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, pg_catalog
AS $$
DECLARE
  v_cutoff timestamptz;
  v_batch integer := 0;
  v_removed integer;
  v_total bigint := 0;
BEGIN
  -- Clamp inputs so a caller cannot request unbounded work.
  p_retain_days := greatest(coalesce(p_retain_days, 14), 7);
  p_batch_size  := least(greatest(coalesce(p_batch_size, 5000), 100), 20000);
  p_max_batches := least(greatest(coalesce(p_max_batches, 20), 1), 200);

  v_cutoff := now() - make_interval(days => p_retain_days);

  WHILE v_batch < p_max_batches LOOP
    WITH doomed AS (
      SELECT ctid
      FROM cron.job_run_details
      WHERE start_time < v_cutoff
      ORDER BY start_time
      LIMIT p_batch_size
    )
    DELETE FROM cron.job_run_details d
    USING doomed
    WHERE d.ctid = doomed.ctid;

    GET DIAGNOSTICS v_removed = ROW_COUNT;
    EXIT WHEN v_removed = 0;          -- nothing left older than the cutoff
    v_total := v_total + v_removed;
    v_batch := v_batch + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'retain_days', p_retain_days,
    'cutoff', v_cutoff,
    'batches', v_batch,
    'rows_deleted', v_total,
    'more_work_pending', v_batch >= p_max_batches,
    'remaining_older_than_cutoff',
      (SELECT count(*) FROM cron.job_run_details WHERE start_time < v_cutoff)
  );
END;
$$;

COMMENT ON FUNCTION public.prune_cron_run_history(integer, integer, integer) IS
  'Batched, rerunnable 14-day retention for cron.job_run_details. Bounded work per call. Internal maintenance only.';

-- Elevated maintenance: postgres/service_role only. Explicitly deny app users.
REVOKE ALL ON FUNCTION public.prune_cron_run_history(integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prune_cron_run_history(integer, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.prune_cron_run_history(integer, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.prune_cron_run_history(integer, integer, integer) TO service_role;