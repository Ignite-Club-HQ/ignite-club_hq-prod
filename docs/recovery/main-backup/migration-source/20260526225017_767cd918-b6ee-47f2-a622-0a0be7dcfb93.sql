-- Client performance log: stores slow/aborted PostgREST GETs from clients
-- so we can see WHICH queries are timing out, on WHICH networks, for WHICH
-- users. Inserted from the browser via the anon-keyed fetch in
-- src/lib/clientPerfLog.ts.

CREATE TABLE IF NOT EXISTS public.client_perf_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NULL,
  query_name text NOT NULL,
  duration_ms integer NOT NULL,
  status integer NULL,
  aborted boolean NOT NULL DEFAULT false,
  network_type text NULL,
  online boolean NOT NULL DEFAULT true,
  url_path text NULL,
  ua text NULL
);

CREATE INDEX IF NOT EXISTS client_perf_log_created_at_idx
  ON public.client_perf_log (created_at DESC);
CREATE INDEX IF NOT EXISTS client_perf_log_query_name_idx
  ON public.client_perf_log (query_name, created_at DESC);

-- Grants: authenticated users can insert (logging their own slowness);
-- only app admins can read. Service role full access for cleanup jobs.
GRANT INSERT ON public.client_perf_log TO authenticated;
GRANT SELECT ON public.client_perf_log TO authenticated;
GRANT ALL ON public.client_perf_log TO service_role;

ALTER TABLE public.client_perf_log ENABLE ROW LEVEL SECURITY;

-- Anyone signed in can insert a row. user_id is optional (anon-keyed
-- fetch is also allowed for diagnostic completeness) but when present
-- must match the caller.
CREATE POLICY "perf_log_insert_self"
  ON public.client_perf_log
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- App admins can read everything.
CREATE POLICY "perf_log_admin_select"
  ON public.client_perf_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'app_admin'::app_role));

-- Auto-purge entries older than 30 days to keep the table small.
CREATE OR REPLACE FUNCTION public.purge_old_client_perf_log()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.client_perf_log WHERE created_at < now() - interval '30 days';
$$;