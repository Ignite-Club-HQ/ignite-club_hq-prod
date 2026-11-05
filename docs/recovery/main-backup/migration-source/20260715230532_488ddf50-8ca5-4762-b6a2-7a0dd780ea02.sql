CREATE TABLE public.home_open_perf (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  tap_to_paint_ms integer NOT NULL,
  query_ms integer,
  first_paint_ms integer,
  cache_hit boolean NOT NULL DEFAULT false,
  context jsonb,
  platform text,
  stages jsonb
);
CREATE INDEX home_open_perf_created_at_idx ON public.home_open_perf (created_at DESC);
CREATE INDEX home_open_perf_user_id_idx ON public.home_open_perf (user_id);
GRANT INSERT ON public.home_open_perf TO authenticated;
GRANT ALL ON public.home_open_perf TO service_role;
ALTER TABLE public.home_open_perf ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users insert own home perf" ON public.home_open_perf
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "App admins view home perf" ON public.home_open_perf
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'app_admin'::app_role));

CREATE TABLE public.schedule_open_perf (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  tap_to_paint_ms integer NOT NULL,
  query_ms integer,
  first_paint_ms integer,
  cache_hit boolean NOT NULL DEFAULT false,
  context jsonb,
  platform text,
  stages jsonb
);
CREATE INDEX schedule_open_perf_created_at_idx ON public.schedule_open_perf (created_at DESC);
CREATE INDEX schedule_open_perf_user_id_idx ON public.schedule_open_perf (user_id);
GRANT INSERT ON public.schedule_open_perf TO authenticated;
GRANT ALL ON public.schedule_open_perf TO service_role;
ALTER TABLE public.schedule_open_perf ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users insert own schedule perf" ON public.schedule_open_perf
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "App admins view schedule perf" ON public.schedule_open_perf
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'app_admin'::app_role));