
CREATE TABLE public.web_vitals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metric_name text NOT NULL,
  metric_value double precision NOT NULL,
  rating text,
  page_path text,
  user_agent text,
  connection_type text,
  device_memory double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.web_vitals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own vitals"
  ON public.web_vitals FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Anon can insert vitals"
  ON public.web_vitals FOR INSERT
  TO anon
  WITH CHECK (user_id IS NULL);

CREATE POLICY "Admins can read vitals"
  ON public.web_vitals FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'app_admin') 
    OR public.has_role(auth.uid(), 'club_admin')
  );

CREATE INDEX idx_web_vitals_metric_created ON public.web_vitals (metric_name, created_at DESC);
CREATE INDEX idx_web_vitals_page_created ON public.web_vitals (page_path, created_at DESC);
