-- 1. Durable outbox for push delivery
CREATE TABLE IF NOT EXISTS public.push_delivery_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL UNIQUE REFERENCES public.notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.push_delivery_queue TO service_role;

ALTER TABLE public.push_delivery_queue ENABLE ROW LEVEL SECURITY;

-- No client policies: this table is server-only (service_role bypasses RLS).

CREATE INDEX IF NOT EXISTS idx_push_delivery_queue_pending
  ON public.push_delivery_queue (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_push_delivery_queue_claimed
  ON public.push_delivery_queue (status, claimed_at);

CREATE OR REPLACE FUNCTION public.push_delivery_queue_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_delivery_queue_touch ON public.push_delivery_queue;
CREATE TRIGGER trg_push_delivery_queue_touch
BEFORE UPDATE ON public.push_delivery_queue
FOR EACH ROW EXECUTE FUNCTION public.push_delivery_queue_touch();

-- Validation trigger for status values (avoids immutable CHECK pitfalls elsewhere)
CREATE OR REPLACE FUNCTION public.push_delivery_queue_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status NOT IN ('pending','processing','delivered','skipped','failed') THEN
    RAISE EXCEPTION 'Invalid push_delivery_queue.status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_delivery_queue_validate ON public.push_delivery_queue;
CREATE TRIGGER trg_push_delivery_queue_validate
BEFORE INSERT OR UPDATE ON public.push_delivery_queue
FOR EACH ROW EXECUTE FUNCTION public.push_delivery_queue_validate();

-- 2. Atomic notification + delivery-job creation
CREATE OR REPLACE FUNCTION public.enqueue_event_push(
  p_url text,
  p_rows jsonb
)
RETURNS TABLE(notification_id uuid, user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH input AS (
    SELECT * FROM jsonb_to_recordset(p_rows)
      AS x(user_id uuid, type text, message text, related_id uuid)
  ),
  ins AS (
    INSERT INTO public.notifications (user_id, type, message, related_id, skip_push)
    SELECT i.user_id, i.type, i.message, i.related_id, true
    FROM input i
    RETURNING id, notifications.user_id, notifications.type, notifications.message
  ),
  q AS (
    INSERT INTO public.push_delivery_queue (notification_id, user_id, payload)
    SELECT
      ins.id,
      ins.user_id,
      jsonb_build_object(
        'title', 'Ignite',
        'body', ins.message,
        'url', p_url,
        'tag', ins.type || '-' || ins.id::text,
        'notificationType', ins.type
      )
    FROM ins
    ON CONFLICT (notification_id) DO NOTHING
    RETURNING push_delivery_queue.notification_id, push_delivery_queue.user_id
  )
  SELECT q.notification_id, q.user_id FROM q;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_event_push(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_event_push(text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_event_push(text, jsonb) TO service_role;

-- 3. Worker job claiming (SKIP LOCKED, reclaims stale processing rows)
CREATE OR REPLACE FUNCTION public.claim_push_delivery_jobs(p_limit integer DEFAULT 25)
RETURNS TABLE(
  id uuid,
  notification_id uuid,
  user_id uuid,
  payload jsonb,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT q.id
    FROM public.push_delivery_queue q
    WHERE (
        (q.status = 'pending' AND q.next_attempt_at <= now())
        OR (q.status = 'processing' AND q.claimed_at < now() - interval '2 minutes')
      )
    ORDER BY q.created_at
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 100))
    FOR UPDATE SKIP LOCKED
  ),
  upd AS (
    UPDATE public.push_delivery_queue q
    SET status = 'processing', claimed_at = now()
    WHERE q.id IN (SELECT claimed.id FROM claimed)
    RETURNING q.id, q.notification_id, q.user_id, q.payload, q.attempt_count
  )
  SELECT upd.id, upd.notification_id, upd.user_id, upd.payload, upd.attempt_count FROM upd;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_push_delivery_jobs(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_push_delivery_jobs(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_delivery_jobs(integer) TO service_role;

-- 4. Environment-aware internal dispatch helpers for the event triggers.
CREATE OR REPLACE FUNCTION public.internal_functions_base_url()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v text;
BEGIN
  SELECT decrypted_secret INTO v FROM vault.decrypted_secrets WHERE name = 'functions_base_url' LIMIT 1;
  RETURN NULLIF(v, '');
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.internal_functions_base_url() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_functions_base_url() FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.internal_service_role_key()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v text;
BEGIN
  SELECT decrypted_secret INTO v FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  RETURN NULLIF(v, '');
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.internal_service_role_key() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_service_role_key() FROM anon, authenticated;

-- 5. Repoint + harden the three event notification triggers.
CREATE OR REPLACE FUNCTION public.on_event_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_id bigint;
  base_url text;
  svc_key text;
BEGIN
  IF NEW.parent_event_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  base_url := public.internal_functions_base_url();
  svc_key := public.internal_service_role_key();
  IF base_url IS NULL OR svc_key IS NULL THEN
    RAISE WARNING 'Event notification dispatch skipped for event %: missing functions_base_url/service_role_key vault secret', NEW.id;
    RETURN NEW;
  END IF;

  SELECT net.http_post(
    url := base_url || '/functions/v1/process-event-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || svc_key
    ),
    body := jsonb_build_object(
      'action', 'event_created',
      'eventId', NEW.id
    )
  ) INTO request_id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Async event notification dispatch failed for event %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.on_event_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_id bigint;
  base_url text;
  svc_key text;
BEGIN
  IF NOT (COALESCE(OLD.is_cancelled, false) = false AND COALESCE(NEW.is_cancelled, false) = true) THEN
    RETURN NEW;
  END IF;

  base_url := public.internal_functions_base_url();
  svc_key := public.internal_service_role_key();
  IF base_url IS NULL OR svc_key IS NULL THEN
    RAISE WARNING 'Event cancel notification dispatch skipped for event %: missing vault secret', NEW.id;
    RETURN NEW;
  END IF;

  SELECT net.http_post(
    url := base_url || '/functions/v1/process-event-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || svc_key
    ),
    body := jsonb_build_object(
      'action', 'event_cancelled',
      'eventId', NEW.id
    )
  ) INTO request_id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Async event cancel notification dispatch failed for event %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.on_event_updated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_id bigint;
  changed_fields jsonb := '[]'::jsonb;
  base_url text;
  svc_key text;
BEGIN
  IF NEW.is_cancelled = true OR NEW.parent_event_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.event_date IS DISTINCT FROM NEW.event_date THEN
    changed_fields := changed_fields || jsonb_build_object('field', 'date', 'old', OLD.event_date, 'new', NEW.event_date);
  END IF;
  IF OLD.start_time IS DISTINCT FROM NEW.start_time THEN
    changed_fields := changed_fields || jsonb_build_object('field', 'start_time', 'old', OLD.start_time, 'new', NEW.start_time);
  END IF;
  IF OLD.meet_time IS DISTINCT FROM NEW.meet_time THEN
    changed_fields := changed_fields || jsonb_build_object('field', 'meet_time', 'old', OLD.meet_time, 'new', NEW.meet_time);
  END IF;
  IF OLD.location IS DISTINCT FROM NEW.location THEN
    changed_fields := changed_fields || jsonb_build_object('field', 'location', 'old', OLD.location, 'new', NEW.location);
  END IF;
  IF OLD.address IS DISTINCT FROM NEW.address THEN
    changed_fields := changed_fields || jsonb_build_object('field', 'address', 'old', OLD.address, 'new', NEW.address);
  END IF;
  IF OLD.title IS DISTINCT FROM NEW.title THEN
    changed_fields := changed_fields || jsonb_build_object('field', 'title', 'old', OLD.title, 'new', NEW.title);
  END IF;
  IF OLD.opponent IS DISTINCT FROM NEW.opponent THEN
    changed_fields := changed_fields || jsonb_build_object('field', 'opponent', 'old', OLD.opponent, 'new', NEW.opponent);
  END IF;

  IF jsonb_array_length(changed_fields) = 0 THEN
    RETURN NEW;
  END IF;

  base_url := public.internal_functions_base_url();
  svc_key := public.internal_service_role_key();
  IF base_url IS NULL OR svc_key IS NULL THEN
    RAISE WARNING 'Event update notification dispatch skipped for event %: missing vault secret', NEW.id;
    RETURN NEW;
  END IF;

  SELECT net.http_post(
    url := base_url || '/functions/v1/process-event-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || svc_key
    ),
    body := jsonb_build_object(
      'action', 'event_updated',
      'eventId', NEW.id,
      'changedFields', changed_fields
    )
  ) INTO request_id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Async event update notification dispatch failed for event %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;