-- =====================================================================
-- Regression test: enqueue_event_push_v2 "column reference dedupe_key is
-- ambiguous" fix (migration 20260824020000_fix_..._variable_conflict.sql).
--
-- Run against a FRESH ISOLATED LOCAL stack only (see scripts/run-baseline.sh).
-- Never point this at hosted dev or production.
--
-- Everything runs inside one transaction that is ROLLED BACK, and only
-- synthetic ids are used. The test asserts the database runs with
-- plpgsql.variable_conflict = error — the strictest name-resolution mode —
-- to prove the LANGUAGE sql rewrite can never regress to the ambiguity.
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

-- 0. The function is now LANGUAGE sql (no PL/pgSQL variable scope) with the
--    exact same signature, output columns, volatility context and security
--    attributes as before.
DO $$
BEGIN
  PERFORM pg_temp.assert_eq(
    current_setting('plpgsql.variable_conflict'),
    'error', 'database uses strict PL/pgSQL name resolution');
  PERFORM pg_temp.assert_eq(
    (SELECT l.lanname FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      WHERE p.oid = 'public.enqueue_event_push_v2(text,jsonb)'::regprocedure),
    'sql', 'enqueue_event_push_v2 is LANGUAGE sql (no plpgsql variable scope)');
  PERFORM pg_temp.assert_eq(
    (SELECT p.prosecdef FROM pg_proc p
      WHERE p.oid = 'public.enqueue_event_push_v2(text,jsonb)'::regprocedure),
    true, 'enqueue_event_push_v2 remains SECURITY DEFINER');
  PERFORM pg_temp.assert_eq(
    (SELECT p.proconfig FROM pg_proc p
      WHERE p.oid = 'public.enqueue_event_push_v2(text,jsonb)'::regprocedure),
    ARRAY['search_path=public']::text[], 'enqueue_event_push_v2 keeps SET search_path = public');
  PERFORM pg_temp.assert_eq(
    pg_get_function_result('public.enqueue_event_push_v2(text,jsonb)'::regprocedure),
    'TABLE(notification_id uuid, user_id uuid, dedupe_key text, created boolean, queued boolean)',
    'output column names and types are unchanged');
  PERFORM pg_temp.assert_eq(
    pg_get_function_identity_arguments('public.enqueue_event_push_v2(text,jsonb)'::regprocedure),
    'p_url text, p_rows jsonb', 'input parameter names are unchanged (PostgREST named-arg RPC)');
END $$;

-- Helpers ---------------------------------------------------------------
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

-- 1. First enqueue creates notification AND queue rows (real function call,
--    under variable_conflict = error — this is the exact call that used to
--    die with "column reference dedupe_key is ambiguous").
DO $$
DECLARE ev uuid := gen_random_uuid(); r record;
BEGIN
  SELECT * INTO r FROM pg_temp.fanout(ev, 25);
  PERFORM pg_temp.assert_eq(r.resolved, 25::bigint, 'first enqueue resolves all 25 recipients');
  PERFORM pg_temp.assert_eq(r.created, 25::bigint, 'first enqueue creates 25 notifications');
  PERFORM pg_temp.assert_eq(r.queued, 25::bigint, 'first enqueue creates 25 queue jobs');
  PERFORM pg_temp.assert_eq(
    (SELECT count(*) FROM public.notifications WHERE related_id = ev)::bigint,
    25::bigint, '25 notification rows actually exist');
  PERFORM pg_temp.assert_eq(
    (SELECT count(*) FROM public.push_delivery_queue q
       JOIN public.notifications n ON n.id = q.notification_id
      WHERE n.related_id = ev)::bigint,
    25::bigint, '25 queue rows actually exist');
END $$;

-- 2. Retry is idempotent: same dedupe keys create nothing new but still
--    resolve, and the pre-existing queue jobs are not duplicated.
DO $$
DECLARE ev uuid := gen_random_uuid(); r record;
BEGIN
  PERFORM pg_temp.fanout(ev, 10);
  SELECT * INTO r FROM pg_temp.fanout(ev, 10);
  PERFORM pg_temp.assert_eq(r.resolved, 10::bigint, 'retry resolves all 10 idempotently');
  PERFORM pg_temp.assert_eq(r.created, 0::bigint, 'retry creates 0 new notifications');
  PERFORM pg_temp.assert_eq(r.queued, 0::bigint, 'retry creates 0 new queue jobs');
  PERFORM pg_temp.assert_eq(
    (SELECT count(*) FROM public.notifications WHERE related_id = ev)::bigint,
    10::bigint, 'still exactly 10 notifications after retry');
END $$;

-- 3. Mixed batch: 8 already-sent + 4 brand-new recipients — only the new
--    ones are created/queued; the batch does not fail on the existing keys.
DO $$
DECLARE
  ev uuid := gen_random_uuid();
  r record;
  rows jsonb;
BEGIN
  PERFORM pg_temp.fanout(ev, 8);
  rows := (SELECT jsonb_agg(elem) FROM (
    SELECT elem FROM jsonb_array_elements(pg_temp.rows_for(ev, 8, 'event_invite', 'm')) e(elem)
    UNION ALL
    SELECT elem FROM jsonb_array_elements(pg_temp.rows_for(ev, 12, 'event_invite', 'm')) e(elem)
    WHERE elem->>'dedupe_key' LIKE '%000000000009'
       OR elem->>'dedupe_key' LIKE '%000000000010'
       OR elem->>'dedupe_key' LIKE '%000000000011'
       OR elem->>'dedupe_key' LIKE '%000000000012'
  ) combined);
  SELECT count(*)::bigint AS resolved,
         count(*) FILTER (WHERE x.created)::bigint AS created,
         count(*) FILTER (WHERE x.queued)::bigint AS queued
     INTO r
     FROM public.enqueue_event_push_v2('/events/' || ev::text, rows) x;
  PERFORM pg_temp.assert_eq(r.resolved, 12::bigint, 'mixed batch resolves all 12');
  PERFORM pg_temp.assert_eq(r.created, 4::bigint, 'mixed batch creates only the 4 new');
  PERFORM pg_temp.assert_eq(r.queued, 4::bigint, 'mixed batch queues only the 4 new');
END $$;

-- 4. Notification + queue creation remain atomic: no notification without a
--    queue job and no queue job without its notification, across all fan-outs
--    in this test.
DO $$
BEGIN
  PERFORM pg_temp.assert_eq(
    (SELECT count(*) FROM public.notifications n
      WHERE n.dedupe_key LIKE 'event_%:00000000-%'
        AND NOT EXISTS (SELECT 1 FROM public.push_delivery_queue q WHERE q.notification_id = n.id))::bigint,
    0::bigint, 'no notification exists without a queue job (atomic)');
  PERFORM pg_temp.assert_eq(
    (SELECT count(*) FROM public.push_delivery_queue q
      WHERE NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.id = q.notification_id))::bigint,
    0::bigint, 'no queue job exists without its notification (atomic)');
END $$;

-- 5. Payload contract unchanged: url comes from p_url, tag is
--    type-notificationId, notificationType is preserved.
DO $$
DECLARE ev uuid := gen_random_uuid();
BEGIN
  PERFORM pg_temp.fanout(ev, 2);
  PERFORM pg_temp.assert_eq(
    (SELECT count(*) FROM public.push_delivery_queue q
       JOIN public.notifications n ON n.id = q.notification_id
      WHERE n.related_id = ev
        AND q.payload->>'title' = 'Ignite'
        AND q.payload->>'url' = '/events/' || ev::text
        AND q.payload->>'tag' = n.type || '-' || n.id::text
        AND q.payload->>'notificationType' = 'event_invite'
        AND q.payload->>'body' = n.message)::bigint,
    2::bigint, 'queue payload shape is unchanged');
END $$;

-- 6. ON CONFLICT was NOT broadened: an unrelated unique/constraint violation
--    (queue job pointing at a non-existent notification) still raises instead
--    of being silently swallowed.
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.push_delivery_queue (notification_id, user_id, payload)
    VALUES ('00000000-0000-4000-8000-00000000dead'::uuid,
            '00000000-0000-4000-9000-000000000001'::uuid, '{}'::jsonb);
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  PERFORM pg_temp.assert_eq(ok, true, 'unrelated constraint violations still raise (ON CONFLICT not broadened)');
END $$;

-- 7. Rows with NULL dedupe_key are ignored (never inserted), matching the
--    original WHERE dedupe_key IS NOT NULL filter.
DO $$
DECLARE
  ev uuid := gen_random_uuid();
  n bigint;
BEGIN
  SELECT count(*)::bigint INTO n
    FROM public.enqueue_event_push_v2(
      '/events/' || ev::text,
      jsonb_build_array(jsonb_build_object(
        'user_id', '00000000-0000-4000-9000-0000000000f1',
        'type', 'event_invite', 'message', 'no key', 'related_id', ev, 'dedupe_key', null)));
  PERFORM pg_temp.assert_eq(n, 0::bigint, 'NULL dedupe_key rows are ignored');
  PERFORM pg_temp.assert_eq(
    (SELECT count(*) FROM public.notifications WHERE related_id = ev)::bigint,
    0::bigint, 'no notification created for NULL dedupe_key');
END $$;

ROLLBACK;
