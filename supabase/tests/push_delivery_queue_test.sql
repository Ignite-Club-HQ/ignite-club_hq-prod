-- =====================================================================
-- Genuine database integration tests for the event push delivery queue.
--
-- Run against a FRESH ISOLATED LOCAL Supabase stack only:
--   supabase start && ./scripts/run-baseline.sh
-- Never point this at hosted dev or production.
--
-- Everything runs inside one transaction that is ROLLED BACK, and only
-- synthetic ids are used (no Riverside / Strathalbyn / real club or user
-- data). External web-push/FCM delivery is never invoked: these tests only
-- exercise the SQL contract (fan-out, idempotency, atomicity, claiming).
-- =====================================================================
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_eq(actual anyelement, expected anyelement, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL % : expected %, got %', label, expected, actual;
  END IF;
  RAISE NOTICE 'ok   %', label;
END;
$$;

-- Synthetic fixtures --------------------------------------------------
CREATE TEMP TABLE t_ids AS
SELECT
  '00000000-0000-4000-8000-0000000000e1'::uuid AS event_id,
  '00000000-0000-4000-8000-0000000000e2'::uuid AS event_id_2;

CREATE OR REPLACE FUNCTION pg_temp.rows_for(p_event uuid, p_n int, p_type text, p_msg text, p_version text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object(
    'user_id', ('00000000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid,
    'type', p_type,
    'message', p_msg,
    'related_id', p_event,
    'dedupe_key', p_type || ':' || p_event::text || ':' ||
                  ('00000000-0000-4000-9000-' || lpad(g::text, 12, '0')) ||
                  COALESCE(':' || p_version, '')
  ))
  FROM generate_series(1, p_n) g;
$$;

CREATE OR REPLACE FUNCTION pg_temp.fanout(p_event uuid, p_n int, p_type text DEFAULT 'event_invite', p_version text DEFAULT NULL)
RETURNS TABLE(resolved bigint, created bigint, queued bigint) LANGUAGE sql AS $$
  SELECT count(*)::bigint,
         count(*) FILTER (WHERE r.created)::bigint,
         count(*) FILTER (WHERE r.queued)::bigint
  FROM public.enqueue_event_push_v2(
    '/events/' || p_event::text,
    pg_temp.rows_for(p_event, p_n, p_type, 'You''ve been invited to: Synthetic Canary', p_version)
  ) r;
$$;

-- 1. Exact fan-out counts at and around the old 20-batch boundary ------
DO $$
DECLARE
  n int;
  ev uuid;
  r record;
BEGIN
  FOREACH n IN ARRAY ARRAY[19, 20, 21, 30, 31, 200, 501] LOOP
    ev := gen_random_uuid();
    SELECT * INTO r FROM pg_temp.fanout(ev, n);
    PERFORM pg_temp.assert_eq(r.created, n::bigint, format('%s recipients -> %s notifications', n, n));
    PERFORM pg_temp.assert_eq(r.queued, n::bigint, format('%s recipients -> %s queue jobs', n, n));
    PERFORM pg_temp.assert_eq(
      (SELECT count(DISTINCT q.notification_id) FROM public.push_delivery_queue q
        JOIN public.notifications nn ON nn.id = q.notification_id
        WHERE nn.related_id = ev)::bigint,
      n::bigint, format('%s recipients -> %s UNIQUE jobs', n, n));
  END LOOP;
END $$;

-- 2. Repeating the same invite fan-out creates no duplicates ----------
DO $$
DECLARE ev uuid := gen_random_uuid(); r record;
BEGIN
  PERFORM pg_temp.fanout(ev, 25);
  SELECT * INTO r FROM pg_temp.fanout(ev, 25);
  PERFORM pg_temp.assert_eq(r.created, 0::bigint, 'repeat invite fan-out creates 0 new notifications');
  PERFORM pg_temp.assert_eq(r.resolved, 25::bigint, 'repeat invite fan-out resolves all 25 idempotently');
  PERFORM pg_temp.assert_eq(r.queued, 0::bigint, 'repeat invite fan-out creates 0 new jobs');
  PERFORM pg_temp.assert_eq(
    (SELECT count(*) FROM public.notifications WHERE related_id = ev)::bigint,
    25::bigint, 'still exactly 25 notifications after retry');
END $$;

-- 3. Notification + queue insertion is atomic -------------------------
DO $$
DECLARE ev uuid := gen_random_uuid();
BEGIN
  PERFORM pg_temp.fanout(ev, 10);
  PERFORM pg_temp.assert_eq(
    (SELECT count(*) FROM public.notifications n
      WHERE n.related_id = ev
        AND NOT EXISTS (SELECT 1 FROM public.push_delivery_queue q WHERE q.notification_id = n.id))::bigint,
    0::bigint, 'no notification exists without a delivery job (atomic)');
  PERFORM pg_temp.assert_eq(
    (SELECT count(*) FROM public.notifications WHERE related_id = ev AND skip_push IS NOT TRUE)::bigint,
    0::bigint, 'all fan-out notifications carry skip_push = true');
END $$;

-- 4. Different legitimate updates stay deliverable, retries dedupe ----
DO $$
DECLARE ev uuid := gen_random_uuid(); r record;
BEGIN
  SELECT * INTO r FROM pg_temp.fanout(ev, 5, 'event_updated', 'v1');
  PERFORM pg_temp.assert_eq(r.created, 5::bigint, 'update v1 creates 5');
  SELECT * INTO r FROM pg_temp.fanout(ev, 5, 'event_updated', 'v1');
  PERFORM pg_temp.assert_eq(r.created, 0::bigint, 'same update retried creates 0');
  SELECT * INTO r FROM pg_temp.fanout(ev, 5, 'event_updated', 'v2');
  PERFORM pg_temp.assert_eq(r.created, 5::bigint, 'different update remains deliverable');
  -- Cancellation is one per event/user regardless of prior updates.
  SELECT * INTO r FROM pg_temp.fanout(ev, 5, 'event_cancelled');
  PERFORM pg_temp.assert_eq(r.created, 5::bigint, 'cancellation creates 5');
  SELECT * INTO r FROM pg_temp.fanout(ev, 5, 'event_cancelled');
  PERFORM pg_temp.assert_eq(r.created, 0::bigint, 'cancellation retried creates 0');
END $$;

-- 5. No RSVP rows are ever created by fan-out -------------------------
DO $$
DECLARE ev uuid := gen_random_uuid(); before bigint;
BEGIN
  SELECT count(*) INTO before FROM public.rsvps;
  PERFORM pg_temp.fanout(ev, 40);
  PERFORM pg_temp.assert_eq((SELECT count(*) FROM public.rsvps)::bigint, before, 'fan-out creates no RSVP rows');
END $$;

-- 6. Claiming: bounded, skip-locked, stale reclaim, terminal never ----
-- Earlier fan-out scenarios intentionally leave queue rows behind within this
-- transaction. Clear those synthetic fixtures so this scenario measures only
-- its own 40 jobs and the 30/10 batch split is deterministic.
TRUNCATE TABLE public.push_delivery_queue, public.notifications CASCADE;

DO $$
DECLARE ev uuid := gen_random_uuid(); c1 bigint; c2 bigint; jid uuid;
BEGIN
  PERFORM pg_temp.fanout(ev, 40);
  SELECT count(*) INTO c1 FROM public.claim_push_delivery_jobs(30);
  PERFORM pg_temp.assert_eq(c1, 30::bigint, 'claim honours the batch bound');
  SELECT count(*) INTO c2 FROM public.claim_push_delivery_jobs(30);
  PERFORM pg_temp.assert_eq(c2, 10::bigint, 'second claim gets only the remainder (no double claim)');
  SELECT count(*) INTO c1 FROM public.claim_push_delivery_jobs(30);
  PERFORM pg_temp.assert_eq(c1, 0::bigint, 'freshly-claimed processing jobs are not reclaimed');

  -- Terminal jobs are never reclaimed.
  UPDATE public.push_delivery_queue SET status = 'delivered', completed_at = now()
   WHERE notification_id IN (SELECT id FROM public.notifications WHERE related_id = ev);
  UPDATE public.push_delivery_queue SET claimed_at = now() - interval '10 minutes'
   WHERE notification_id IN (SELECT id FROM public.notifications WHERE related_id = ev);
  SELECT count(*) INTO c1 FROM public.claim_push_delivery_jobs(50);
  PERFORM pg_temp.assert_eq(c1, 0::bigint, 'terminal jobs are never reclaimed');

  -- Stale processing IS reclaimed.
  UPDATE public.push_delivery_queue
     SET status = 'processing', claimed_at = now() - interval '10 minutes', completed_at = NULL
   WHERE notification_id IN (SELECT id FROM public.notifications WHERE related_id = ev);
  SELECT count(*) INTO c1 FROM public.claim_push_delivery_jobs(50);
  PERFORM pg_temp.assert_eq(c1, 40::bigint, 'stale processing jobs are reclaimed');
END $$;

-- 7. Future next_attempt_at jobs are not claimed early ----------------
DO $$
DECLARE ev uuid := gen_random_uuid(); c bigint;
BEGIN
  PERFORM pg_temp.fanout(ev, 5);
  UPDATE public.push_delivery_queue
     SET status = 'pending', next_attempt_at = now() + interval '1 hour', claimed_at = NULL
   WHERE notification_id IN (SELECT id FROM public.notifications WHERE related_id = ev);
  SELECT count(*) INTO c FROM public.claim_push_delivery_jobs(50);
  PERFORM pg_temp.assert_eq(c, 0::bigint, 'future next_attempt_at is not claimed early');
END $$;

-- 8. Invalid status is rejected ---------------------------------------
DO $$
DECLARE ev uuid := gen_random_uuid(); ok boolean := false;
BEGIN
  PERFORM pg_temp.fanout(ev, 1);
  BEGIN
    UPDATE public.push_delivery_queue SET status = 'bogus'
     WHERE notification_id IN (SELECT id FROM public.notifications WHERE related_id = ev);
  EXCEPTION WHEN others THEN ok := true;
  END;
  PERFORM pg_temp.assert_eq(ok, true, 'invalid queue status is rejected');
END $$;

-- 9. Scoped repair queues ONLY missing attempts ------------------------
DO $$
DECLARE ev uuid := gen_random_uuid(); r record;
BEGIN
  PERFORM pg_temp.fanout(ev, 10);
  -- Simulate 4 notifications that never got a queue job at all.
  DELETE FROM public.push_delivery_queue
   WHERE notification_id IN (
     SELECT id FROM public.notifications WHERE related_id = ev ORDER BY id LIMIT 4
   );
  SELECT * INTO r FROM public.repair_event_push_queue(ev, true);
  PERFORM pg_temp.assert_eq(r.candidate_count, 4::bigint, 'repair dry-run finds only the 4 missing');
  PERFORM pg_temp.assert_eq(r.queued_count, 0::bigint, 'repair dry-run queues nothing');
  -- repair_event_push_queue() builds a TEMP TABLE ... ON COMMIT DROP. In real
  -- use each call is its own autocommit statement, so it is dropped between
  -- calls; here everything shares one transaction, so drop it explicitly.
  DROP TABLE IF EXISTS _repair_candidates;
  SELECT * INTO r FROM public.repair_event_push_queue(ev, false);
  PERFORM pg_temp.assert_eq(r.queued_count, 4::bigint, 'repair queues exactly the 4 missing');
  PERFORM pg_temp.assert_eq(
    (SELECT count(*) FROM public.push_delivery_queue q
      JOIN public.notifications n ON n.id = q.notification_id WHERE n.related_id = ev)::bigint,
    10::bigint, 'repair never duplicates existing jobs');
  DROP TABLE IF EXISTS _repair_candidates;
  SELECT * INTO r FROM public.repair_event_push_queue(ev, false);
  PERFORM pg_temp.assert_eq(r.queued_count, 0::bigint, 'repair is idempotent');

END $$;

-- 10. Cron: exactly one named worker job, correct target and schedule --
DO $$
BEGIN
  PERFORM pg_temp.assert_eq(
    (SELECT count(*) FROM cron.job WHERE jobname = 'ignite-push-delivery-queue-worker')::bigint,
    1::bigint, 'exactly one named queue-worker cron job exists');
  PERFORM pg_temp.assert_eq(
    (SELECT schedule FROM cron.job WHERE jobname = 'ignite-push-delivery-queue-worker'),
    '* * * * *', 'cron job runs every minute');
  PERFORM pg_temp.assert_eq(
    (SELECT command LIKE '%process-push-delivery-queue%' AND command NOT LIKE '%process-event-notifications%'
       FROM cron.job WHERE jobname = 'ignite-push-delivery-queue-worker'),
    true, 'cron job calls only process-push-delivery-queue');
  PERFORM pg_temp.assert_eq(
    (SELECT command LIKE '%internal_functions_base_url%' AND command LIKE '%internal_service_role_key%'
       FROM cron.job WHERE jobname = 'ignite-push-delivery-queue-worker'),
    true, 'cron job reads config through the approved secure helpers');
  PERFORM pg_temp.assert_eq(
    (SELECT bool_or(command ~* '(https://[a-z0-9-]+\.supabase\.co|eyJ|sb_secret_)')
       FROM cron.job WHERE jobname = 'ignite-push-delivery-queue-worker'),
    false, 'cron job embeds no hosted URL, project ref or secret');
END $$;

-- 11. Queue and helper functions are not reachable by anon/authenticated
DO $$
BEGIN
  PERFORM pg_temp.assert_eq(
    (SELECT bool_or(has_function_privilege(r.rolname, p.oid, 'EXECUTE'))
       FROM pg_proc p, unnest(ARRAY['anon','authenticated']) AS r(rolname)
      WHERE p.proname IN ('enqueue_event_push_v2','claim_push_delivery_jobs','repair_event_push_queue',
                          'push_delivery_preflight','push_delivery_queue_stats',
                          'internal_functions_base_url','internal_service_role_key')),
    false, 'no queue/config function is executable by anon or authenticated');
  PERFORM pg_temp.assert_eq(
    (SELECT bool_or(has_table_privilege(r.rolname, 'public.push_delivery_queue', 'SELECT'))
       FROM unnest(ARRAY['anon','authenticated']) AS r(rolname)),
    false, 'push_delivery_queue is not readable by anon or authenticated');
  PERFORM pg_temp.assert_eq(
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.push_delivery_queue'::regclass),
    true, 'RLS is enabled on push_delivery_queue');
END $$;

-- 12. Preflight covers every prerequisite and never echoes secrets ----
--     On a local stack the Vault secrets are legitimately absent, so only
--     the extension/cron checks must be green; the vault checks must be
--     PRESENT and must fail loudly rather than be missing.
DO $$
BEGIN
  PERFORM pg_temp.assert_eq(
    (SELECT array_agg(check_name ORDER BY check_name) FROM public.push_delivery_preflight()),
    ARRAY['functions_base_url_present','functions_base_url_valid','pg_cron','pg_net',
          'queue_worker_cron','service_role_key_not_placeholder','service_role_key_present',
          'supabase_vault']::text[],
    'preflight checks every prerequisite');
  PERFORM pg_temp.assert_eq(
    (SELECT count(*) FROM public.push_delivery_preflight()
      WHERE NOT ok AND check_name IN ('pg_cron','pg_net','supabase_vault','queue_worker_cron'))::bigint,
    0::bigint, 'extensions and cron worker are green');
  PERFORM pg_temp.assert_eq(
    (SELECT bool_or(detail ~* '(eyJ|sb_secret_|https://[a-z0-9-]+\.supabase\.co)')
       FROM public.push_delivery_preflight()),
    false, 'preflight never returns secret or URL values');
END $$;


ROLLBACK;
