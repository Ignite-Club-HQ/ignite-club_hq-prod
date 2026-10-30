
CREATE TABLE IF NOT EXISTS public.cron_locks (
  key text PRIMARY KEY,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

GRANT ALL ON public.cron_locks TO service_role;

ALTER TABLE public.cron_locks ENABLE ROW LEVEL SECURITY;

-- No policies: only service_role (and SECURITY DEFINER functions) can touch it.

CREATE OR REPLACE FUNCTION public.try_cron_lock(p_key text, p_ttl_seconds int DEFAULT 600)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  acquired boolean;
BEGIN
  WITH upsert AS (
    INSERT INTO public.cron_locks (key, acquired_at, expires_at)
    VALUES (p_key, now(), now() + make_interval(secs => p_ttl_seconds))
    ON CONFLICT (key) DO UPDATE
      SET acquired_at = now(),
          expires_at  = now() + make_interval(secs => p_ttl_seconds)
      WHERE public.cron_locks.expires_at < now()
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM upsert) INTO acquired;
  RETURN acquired;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_cron_lock(p_key text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.cron_locks WHERE key = p_key;
$$;

GRANT EXECUTE ON FUNCTION public.try_cron_lock(text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_cron_lock(text) TO service_role;
