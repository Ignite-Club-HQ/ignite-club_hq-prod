
CREATE TABLE public.inbox_open_perf (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  tap_to_paint_ms integer NOT NULL,
  bootstrap_ms integer,
  first_paint_ms integer,
  cache_hit boolean NOT NULL DEFAULT false,
  bootstrap_enabled boolean NOT NULL DEFAULT false,
  section_counts jsonb,
  platform text,
  stages jsonb
);

CREATE INDEX inbox_open_perf_created_at_idx ON public.inbox_open_perf (created_at DESC);
CREATE INDEX inbox_open_perf_user_id_idx ON public.inbox_open_perf (user_id);

GRANT INSERT ON public.inbox_open_perf TO authenticated;
GRANT ALL ON public.inbox_open_perf TO service_role;

ALTER TABLE public.inbox_open_perf ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert own inbox perf" ON public.inbox_open_perf
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "App admins view inbox perf" ON public.inbox_open_perf
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'app_admin'::app_role));
