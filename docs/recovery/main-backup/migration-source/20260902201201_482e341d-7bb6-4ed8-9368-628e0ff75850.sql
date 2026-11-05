-- Rewrite: the previous version sorted the whole (unindexed) start_time column
-- on every batch, which made each DELETE prohibitively slow. cron.job_run_details
-- only has an index on runid, and runid is monotonic, so resolve a runid ceiling
-- once and then delete via the primary key.
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
  v_max_runid bigint;
  v_batch integer := 0;
  v_removed integer;
  v_total bigint := 0;
BEGIN
  -- Clamp inputs so a caller cannot request unbounded work.
  p_retain_days := greatest(coalesce(p_retain_days, 14), 7);
  p_batch_size  := least(greatest(coalesce(p_batch_size, 5000), 100), 20000);
  p_max_batches := least(greatest(coalesce(p_max_batches, 20), 1), 200);

  v_cutoff := now() - make_interval(days => p_retain_days);

  -- Highest runid that is definitely older than the cutoff. runid is assigned
  -- monotonically, so everything at or below this is safe to delete. NULL means
  -- there is no history older than the cutoff at all.
  SELECT max(runid) INTO v_max_runid
  FROM cron.job_run_details
  WHERE start_time < v_cutoff;

  IF v_max_runid IS NULL THEN
    RETURN jsonb_build_object(
      'retain_days', p_retain_days, 'cutoff', v_cutoff, 'batches', 0,
      'rows_deleted', 0, 'more_work_pending', false,
      'remaining_older_than_cutoff', 0
    );
  END IF;

  WHILE v_batch < p_max_batches LOOP
    -- Index-driven batch: PK scan on runid, plus the start_time predicate as a
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
    EXIT WHEN v_removed = 0;          -- nothing left older than the cutoff
    v_total := v_total + v_removed;
    v_batch := v_batch + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'retain_days', p_retain_days,
    'cutoff', v_cutoff,
    'batches', v_batch,
    'rows_deleted', v_total,
    'more_work_pending', v_batch >= p_max_batches
  );
END;
$$;

COMMENT ON FUNCTION public.prune_cron_run_history(integer, integer, integer) IS
  'Batched, rerunnable 14-day retention for cron.job_run_details. Index-driven, bounded work per call. Internal maintenance only.';

REVOKE ALL ON FUNCTION public.prune_cron_run_history(integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prune_cron_run_history(integer, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.prune_cron_run_history(integer, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.prune_cron_run_history(integer, integer, integer) TO service_role;