-- =====================================================================
-- FIX: column reference "dedupe_key" is ambiguous in enqueue_event_push_v2
-- (event/notification tranche — intentionally separate from tranche 00)
--
-- Root cause: the original PL/pgSQL definition (see
-- 20260726104123_ac48de2e-512a-4178-b50f-cf07472be669.sql, NOT edited here)
-- declares RETURNS TABLE(... dedupe_key text ...), which creates a PL/pgSQL
-- output variable named dedupe_key. Its body then references dedupe_key
-- unqualified in the ON CONFLICT arbiter:
--   ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL
-- Under plpgsql.variable_conflict = error that reference collides with the
-- output variable and the function fails at runtime with:
--   ERROR: column reference "dedupe_key" is ambiguous
-- ...which silently prevented event-created / event-updated / event-cancelled
-- notifications from being enqueued (the caller logs and continues).
--
-- Fix: re-create the function as LANGUAGE sql. The body is a single CTE
-- statement, and SQL-language functions have no PL/pgSQL variable scope, so
-- output column names can never collide with table columns. Behaviour,
-- signature, output columns, dedup semantics, atomicity and privileges are
-- unchanged:
--   - same signature: (p_url text, p_rows jsonb)
--   - same output columns/types
--   - same atomic notification + queue insertion (one statement)
--   - same partial unique-index dedup on non-null dedupe_key
--   - ON CONFLICT still targets ONLY the dedupe_key / notification_id
--     arbiters — it is NOT broadened, so unrelated unique violations still
--     raise.
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
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
SELECT r.id AS notification_id,
       r.user_id,
       r.dedupe_key,
       r.created,
       EXISTS (SELECT 1 FROM q WHERE q.notification_id = r.id) AS queued
FROM resolved r;
$$;

-- Privileges unchanged from the original definition.
REVOKE ALL ON FUNCTION public.enqueue_event_push_v2(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_event_push_v2(text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_event_push_v2(text, jsonb) TO service_role;