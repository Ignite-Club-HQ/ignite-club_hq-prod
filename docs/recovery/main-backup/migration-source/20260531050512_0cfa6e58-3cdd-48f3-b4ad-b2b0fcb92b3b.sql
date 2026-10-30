
CREATE TABLE public.realtime_perf_samples (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  channel TEXT NOT NULL,
  event TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  platform TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rt_perf_received_at ON public.realtime_perf_samples (received_at DESC);
CREATE INDEX idx_rt_perf_channel ON public.realtime_perf_samples (channel, received_at DESC);

GRANT SELECT, INSERT ON public.realtime_perf_samples TO authenticated;
GRANT USAGE ON SEQUENCE public.realtime_perf_samples_id_seq TO authenticated;
GRANT ALL ON public.realtime_perf_samples TO service_role;
GRANT ALL ON SEQUENCE public.realtime_perf_samples_id_seq TO service_role;

ALTER TABLE public.realtime_perf_samples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert their own perf samples"
  ON public.realtime_perf_samples
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "App admins read all perf samples"
  ON public.realtime_perf_samples
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'app_admin'));
