CREATE OR REPLACE FUNCTION public.prune_telemetry_tables(
  p_perf_retain_days integer DEFAULT 30,
  p_analytics_retain_days integer DEFAULT 90,
  p_batch_size integer DEFAULT 5000,
  p_max_batches integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_perf_days integer;
  v_analytics_days integer;
  v_batch_size integer;
  v_max_batches integer;
  v_tbl text;
  v_cutoff timestamptz;
  v_batch integer;
  v_removed integer;
  v_total bigint;
  v_result jsonb := '{}'::jsonb;
  v_targets text[] := ARRAY[
    'chat_open_perf','home_open_perf','inbox_open_perf','schedule_open_perf',
    'client_perf_log','realtime_perf_samples','web_vitals','sponsor_analytics'
  ];
BEGIN
  IF NOT (auth.role() = 'service_role' OR current_user IN ('postgres','supabase_admin')) THEN
    RAISE EXCEPTION 'prune_telemetry_tables: service role required';
  END IF;

  v_perf_days      := least(greatest(coalesce(p_perf_retain_days, 30), 7), 365);
  v_analytics_days := least(greatest(coalesce(p_analytics_retain_days, 90), 30), 730);
  v_batch_size     := least(greatest(coalesce(p_batch_size, 5000), 100), 20000);
  v_max_batches    := least(greatest(coalesce(p_max_batches, 20), 1), 200);

  FOREACH v_tbl IN ARRAY v_targets LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_tbl AND c.relkind = 'r'
    ) THEN
      CONTINUE;
    END IF;

    v_cutoff := now() - make_interval(days => CASE WHEN v_tbl = 'sponsor_analytics'
                                                  THEN v_analytics_days ELSE v_perf_days END);
    v_batch := 0;
    v_total := 0;

    WHILE v_batch < v_max_batches LOOP
      EXECUTE format(
        'WITH doomed AS (SELECT id FROM public.%I WHERE created_at < $1 LIMIT %s)
         DELETE FROM public.%I t USING doomed WHERE t.id = doomed.id',
        v_tbl, v_batch_size, v_tbl
      ) USING v_cutoff;
      GET DIAGNOSTICS v_removed = ROW_COUNT;
      EXIT WHEN v_removed = 0;
      v_total := v_total + v_removed;
      v_batch := v_batch + 1;
    END LOOP;

    v_result := v_result || jsonb_build_object(
      v_tbl, jsonb_build_object(
        'cutoff', v_cutoff,
        'batches', v_batch,
        'rows_deleted', v_total,
        'more_work_pending', v_batch >= v_max_batches
      )
    );
  END LOOP;

  RETURN jsonb_build_object('ran_at', now(), 'per_table', v_result);
END;
$function$;

REVOKE ALL ON FUNCTION public.prune_telemetry_tables(integer, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_telemetry_tables(integer, integer, integer, integer) TO service_role;

DO $$
BEGIN
  PERFORM cron.schedule(
    'prune-telemetry-tables-nightly',
    '30 3 * * *',
    'SELECT public.prune_telemetry_tables(30, 90, 5000, 20);'
  );
EXCEPTION WHEN others THEN
  RAISE NOTICE 'could not schedule prune-telemetry-tables-nightly: %', SQLERRM;
END $$;

DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS job_run_details_jobid_start_time_idx
    ON cron.job_run_details (jobid, start_time DESC);
EXCEPTION WHEN others THEN
  RAISE NOTICE 'could not create cron.job_run_details index: %', SQLERRM;
END $$;