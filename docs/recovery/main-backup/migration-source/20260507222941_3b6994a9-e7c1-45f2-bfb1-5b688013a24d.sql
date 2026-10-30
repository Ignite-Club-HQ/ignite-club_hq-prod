CREATE TABLE IF NOT EXISTS public.chat_open_perf (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  chat_kind text NOT NULL,
  target_id uuid NOT NULL,
  source text NOT NULL,
  tap_to_render_ms integer NOT NULL,
  message_count integer,
  from_cache boolean,
  platform text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_open_perf_kind_created ON public.chat_open_perf(chat_kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_open_perf_user_created ON public.chat_open_perf(user_id, created_at DESC);

ALTER TABLE public.chat_open_perf ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert own chat perf"
  ON public.chat_open_perf FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "App admins read chat perf"
  ON public.chat_open_perf FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'app_admin'::app_role));