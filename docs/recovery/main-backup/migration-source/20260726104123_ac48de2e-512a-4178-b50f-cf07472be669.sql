-- =====================================================================
-- 0. DEPLOYMENT PREFLIGHT — fail loudly rather than silently disabling
--    event notifications. No secret value is ever emitted.
-- =====================================================================
DO $preflight$
DECLARE
  v_base text;
  v_key text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'Push delivery preflight failed: extension pg_cron is not installed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'Push delivery preflight failed: extension pg_net is not installed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'supabase_vault') THEN
    RAISE EXCEPTION 'Push delivery preflight failed: extension supabase_vault is not installed';
  END IF;

  SELECT decrypted_secret INTO v_base FROM vault.decrypted_secrets WHERE name = 'functions_base_url' LIMIT 1;
  IF v_base IS NULL OR btrim(v_base) = '' THEN
    RAISE EXCEPTION 'Push delivery preflight failed: Vault secret functions_base_url is missing. Create it in Supabase Dashboard > Project Settings > Vault with value https://<project-ref>.supabase.co (no trailing slash), then re-run.';
  END IF;
  IF v_base !~ '^https://[a-z0-9.-]+\.supabase\.(co|in)$' THEN
    RAISE EXCEPTION 'Push delivery preflight failed: Vault secret functions_base_url is not a valid HTTPS Supabase base URL (expected https://<project-ref>.supabase.co with no path and no trailing slash).';
  END IF;

  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  IF v_key IS NULL OR btrim(v_key) = '' THEN
    RAISE EXCEPTION 'Push delivery preflight failed: Vault secret service_role_key is missing. Create it in Supabase Dashboard > Project Settings > Vault, pasting the project service-role key, then re-run.';
  END IF;
  IF length(v_key) < 20
     OR v_key ~ '\s'
     OR lower(v_key) ~ '(placeholder|changeme|todo|your[-_ ]?key|xxxx)' THEN
    RAISE EXCEPTION 'Push delivery preflight failed: Vault secret service_role_key rejected (length=%, has_whitespace=%, placeholder_words=%). No value is logged.',
      length(v_key), (v_key ~ '\s'), (lower(v_key) ~ '(placeholder|changeme|todo|your[-_ ]?key|xxxx)');
  END IF;
END
$preflight$;

-- Read-only preflight surface for operators / deploy validation.
-- Reports presence + validity ONLY, never the decrypted values.
CREATE OR REPLACE FUNCTION public.push_delivery_preflight()
RETURNS TABLE(
  check_name text,
  ok boolean,
  detail text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base text;
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_base FROM vault.decrypted_secrets WHERE name = 'functions_base_url' LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;

  RETURN QUERY SELECT 'pg_cron'::text,
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'),
    'scheduler extension'::text;
  RETURN QUERY SELECT 'pg_net'::text,
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net'),
    'http dispatch extension'::text;
  RETURN QUERY SELECT 'supabase_vault'::text,
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'supabase_vault'),
    'secret storage extension'::text;
  RETURN QUERY SELECT 'functions_base_url_present'::text,
    (v_base IS NOT NULL AND btrim(v_base) <> ''),
    'vault secret exists'::text;
  RETURN QUERY SELECT 'functions_base_url_valid'::text,
    (v_base IS NOT NULL AND v_base ~ '^https://[a-z0-9.-]+\.supabase\.(co|in)$'),
    'https supabase base url, no trailing slash'::text;
  RETURN QUERY SELECT 'service_role_key_present'::text,
    (v_key IS NOT NULL AND btrim(v_key) <> ''),
    'vault secret exists'::text;
  RETURN QUERY SELECT 'service_role_key_not_placeholder'::text,
    (v_key IS NOT NULL AND length(v_key) >= 20 AND v_key !~ '\s'
      AND lower(v_key) !~ '(placeholder|changeme|todo|your[-_ ]?key|xxxx)'),
    'looks like a real service-role key'::text;
  RETURN QUERY SELECT 'queue_worker_cron'::text,
    EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ignite-push-delivery-queue-worker' AND active),
    'named cron job installed and active'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.push_delivery_preflight() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.push_delivery_preflight() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_delivery_preflight() TO service_role;

-- =====================================================================
-- 1. DATABASE-ENFORCED IDEMPOTENCY
-- =====================================================================
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe_key
  ON public.notifications (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- =====================================================================
-- 2. ATOMIC, IDEMPOTENT ENQUEUE (notification + delivery job together)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.enqueue_event_push_v2(
  p_url text,
  p_rows jsonb
)
RETURNS TABLE(
  notification_id uuid,
  user_id uuid,
  dedupe_key text,
  created boolean,
  queued boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH input AS (
    SELECT DISTINCT ON (x.dedupe_key)
      x.user_id, x.type, x.message, x.related_id, x.dedupe_key
    FROM jsonb_to_recordset(p_rows)
      AS x(user_id uuid, type text, message text, related_id uuid, dedupe_key text)
    WHERE x.dedupe_key IS NOT NULL
  ),
  ins AS (
    INSERT INTO public.notifications (user_id, type, message, related_id, skip_push, dedupe_key)
    SELECT i.user_id, i.type, i.message, i.related_id, true, i.dedupe_key
    FROM input i
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING notifications.id, notifications.user_id, notifications.type,
              notifications.message, notifications.dedupe_key
  ),
  resolved AS (
    SELECT ins.id, ins.user_id, ins.type, ins.message, ins.dedupe_key, true AS created FROM ins
    UNION ALL
    SELECT n.id, n.user_id, n.type, n.message, n.dedupe_key, false
    FROM public.notifications n
    JOIN input i ON i.dedupe_key = n.dedupe_key
    WHERE NOT EXISTS (SELECT 1 FROM ins WHERE ins.dedupe_key = n.dedupe_key)
  ),
  q AS (
    INSERT INTO public.push_delivery_queue (notification_id, user_id, payload)
    SELECT
      r.id,
      r.user_id,
      jsonb_build_object(
        'title', 'Ignite',
        'body', r.message,
        'url', p_url,
        'tag', r.type || '-' || r.id::text,
        'notificationType', r.type
      )
    FROM resolved r
    ON CONFLICT (notification_id) DO NOTHING
    RETURNING push_delivery_queue.notification_id
  )
  SELECT r.id, r.user_id, r.dedupe_key, r.created,
         EXISTS (SELECT 1 FROM q WHERE q.notification_id = r.id)
  FROM resolved r;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_event_push_v2(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_event_push_v2(text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_event_push_v2(text, jsonb) TO service_role;

-- =====================================================================
-- 3. MONITORING SURFACES (service_role only)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.push_delivery_queue_stats()
RETURNS TABLE(status text, jobs bigint, oldest_created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT q.status, count(*)::bigint, min(q.created_at)
  FROM public.push_delivery_queue q
  GROUP BY q.status
$$;

REVOKE ALL ON FUNCTION public.push_delivery_queue_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.push_delivery_queue_stats() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_delivery_queue_stats() TO service_role;

CREATE OR REPLACE FUNCTION public.push_delivery_cron_failures(p_limit integer DEFAULT 20)
RETURNS TABLE(run_start timestamptz, status text, return_message text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.start_time, d.status::text, left(coalesce(d.return_message, ''), 400)
  FROM cron.job_run_details d
  JOIN cron.job j ON j.jobid = d.jobid
  WHERE j.jobname = 'ignite-push-delivery-queue-worker'
    AND d.status <> 'succeeded'
  ORDER BY d.start_time DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 200))
$$;

REVOKE ALL ON FUNCTION public.push_delivery_cron_failures(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.push_delivery_cron_failures(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_delivery_cron_failures(integer) TO service_role;

-- =====================================================================
-- 4. SCOPED REPAIR — queues ONLY missing attempts for one event.
--    Never re-pushes a notification that already has a push log or job.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.repair_event_push_queue(
  p_event_id uuid,
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE(candidate_count bigint, queued_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidates bigint := 0;
  v_queued bigint := 0;
BEGIN
  CREATE TEMP TABLE _repair_candidates ON COMMIT DROP AS
  SELECT n.id, n.user_id, n.type, n.message
  FROM public.notifications n
  WHERE n.related_id = p_event_id
    AND n.type IN ('event_invite', 'event_updated', 'event_cancelled')
    AND NOT EXISTS (SELECT 1 FROM public.push_delivery_queue q WHERE q.notification_id = n.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.push_notification_logs l
      WHERE l.user_id = n.user_id
        AND l.created_at >= n.created_at - interval '1 hour'
        AND l.created_at <= n.created_at + interval '1 day'
    );

  SELECT count(*) INTO v_candidates FROM _repair_candidates;

  IF NOT p_dry_run THEN
    WITH q AS (
      INSERT INTO public.push_delivery_queue (notification_id, user_id, payload)
      SELECT c.id, c.user_id,
        jsonb_build_object(
          'title', 'Ignite',
          'body', c.message,
          'url', '/events/' || p_event_id::text,
          'tag', c.type || '-' || c.id::text,
          'notificationType', c.type
        )
      FROM _repair_candidates c
      ON CONFLICT (notification_id) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_queued FROM q;
  END IF;

  RETURN QUERY SELECT v_candidates, v_queued;
END;
$$;

REVOKE ALL ON FUNCTION public.repair_event_push_queue(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.repair_event_push_queue(uuid, boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_event_push_queue(uuid, boolean) TO service_role;

-- =====================================================================
-- 5. THE REAL SCHEDULED WORKER (authoritative recovery mechanism)
--    Stable unique name; unschedule-then-schedule => idempotent.
--    Config read from Vault at run time; no URLs/keys in migration text.
-- =====================================================================
DO $cron$
DECLARE
  v_job record;
BEGIN
  -- Remove the legacy ad-hoc job (created outside migrations) and any
  -- previous incarnation of the named job. Nothing else is touched.
  FOR v_job IN
    SELECT jobname FROM cron.job
    WHERE jobname IN ('ignite-push-delivery-queue-worker', 'drain-push-delivery-queue')
  LOOP
    PERFORM cron.unschedule(v_job.jobname);
  END LOOP;

  PERFORM cron.schedule(
    'ignite-push-delivery-queue-worker',
    '* * * * *',
    $job$
    SELECT net.http_post(
      url := public.internal_functions_base_url() || '/functions/v1/process-push-delivery-queue',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || public.internal_service_role_key()
      ),
      body := jsonb_build_object('source', 'cron'),
      timeout_milliseconds := 25000
    )
    WHERE public.internal_functions_base_url() IS NOT NULL
      AND public.internal_service_role_key() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.push_delivery_queue q
        WHERE (q.status = 'pending' AND q.next_attempt_at <= now())
           OR (q.status = 'processing' AND q.claimed_at < now() - interval '2 minutes')
      );
    $job$
  );
END
$cron$;

-- Rollback (documented, not executed):
--   SELECT cron.unschedule('ignite-push-delivery-queue-worker');
-- This stops only this worker. It deletes no queue rows and no notifications.