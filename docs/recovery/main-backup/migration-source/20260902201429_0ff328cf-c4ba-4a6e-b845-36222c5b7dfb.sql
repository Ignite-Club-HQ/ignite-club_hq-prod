-- Locating the cutoff with max(runid) required a full scan of an unindexed,
-- bloated column. Replace it with a bounded binary search over runid (the only
-- indexed column), which is O(log n) index lookups.
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
  v_lo bigint;
  v_hi bigint;
  v_mid bigint;
  v_probe timestamptz;
  v_max_runid bigint;
  v_iter integer := 0;
  v_batch integer := 0;
  v_removed integer;
  v_total bigint := 0;
BEGIN
  -- Clamp inputs so a caller cannot request unbounded work.
  p_retain_days := greatest(coalesce(p_retain_days, 14), 7);
  p_batch_size  := least(greatest(coalesce(p_batch_size, 5000), 100), 20000);
  p_max_batches := least(greatest(coalesce(p_max_batches, 20), 1), 200);

  v_cutoff := now() - make_interval(days => p_retain_days);

  SELECT runid INTO v_lo FROM cron.job_run_details ORDER BY runid ASC  LIMIT 1;
  SELECT runid INTO v_hi FROM cron.job_run_details ORDER BY runid DESC LIMIT 1;
  IF v_lo IS NULL THEN
    RETURN jsonb_build_object('retain_days', p_retain_days, 'cutoff', v_cutoff,
      'batches', 0, 'rows_deleted', 0, 'more_work_pending', false);
  END IF;

  -- Oldest row is already inside the retention window -> nothing to do.
  SELECT start_time INTO v_probe FROM cron.job_run_details WHERE runid = v_lo;
  IF v_probe IS NULL OR v_probe >= v_cutoff THEN
    RETURN jsonb_build_object('retain_days', p_retain_days, 'cutoff', v_cutoff,
      'batches', 0, 'rows_deleted', 0, 'more_work_pending', false);
  END IF;

  -- Binary search for the greatest runid whose start_time is still < cutoff.
  v_max_runid := v_lo;
  WHILE v_lo <= v_hi AND v_iter < 64 LOOP
    v_iter := v_iter + 1;
    v_mid := v_lo + (v_hi - v_lo) / 2;
    -- Nearest existing row at or below v_mid (index scan on the primary key).
    SELECT start_time INTO v_probe
    FROM cron.job_run_details
    WHERE runid <= v_mid
    ORDER BY runid DESC
    LIMIT 1;

    IF v_probe IS NULL THEN
      v_lo := v_mid + 1;
    ELSIF v_probe < v_cutoff THEN
      v_max_runid := v_mid;
      v_lo := v_mid + 1;
    ELSE
      v_hi := v_mid - 1;
    END IF;
  END LOOP;

  WHILE v_batch < p_max_batches LOOP
    -- Index-driven batch on the primary key, with the start_time predicate as a
    -- belt-and-braces guard so a recent row can never be removed.
    WITH doomed AS (
      SELECT runid
      FROM cron.job_run_details
      WHERE runid <= v_max_runid
        AND start_time < v_cutoff
      LIMIT p_batch_size
    )
    DELETE FROM cron.job_run_details d
    USING doomed
    WHERE d.runid = doomed.runid;

    GET DIAGNOSTICS v_removed = ROW_COUNT;
    EXIT WHEN v_removed = 0;
    v_total := v_total + v_removed;
    v_batch := v_batch + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'retain_days', p_retain_days,
    'cutoff', v_cutoff,
    'cutoff_runid', v_max_runid,
    'batches', v_batch,
    'rows_deleted', v_total,
    'more_work_pending', v_batch >= p_max_batches
  );
END;
$$;

COMMENT ON FUNCTION public.prune_cron_run_history(integer, integer, integer) IS
  'Batched, rerunnable 14-day retention for cron.job_run_details. Index-driven (binary search for cutoff runid), bounded work per call. Internal maintenance only.';

REVOKE ALL ON FUNCTION public.prune_cron_run_history(integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prune_cron_run_history(integer, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.prune_cron_run_history(integer, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.prune_cron_run_history(integer, integer, integer) TO service_role;