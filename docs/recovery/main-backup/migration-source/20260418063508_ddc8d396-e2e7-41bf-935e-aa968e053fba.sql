
CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  platform TEXT,
  user_agent TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_presence_last_seen ON public.user_presence (last_seen_at DESC);

ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

-- Users can upsert their own presence
CREATE POLICY "Users can upsert own presence"
  ON public.user_presence
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own presence"
  ON public.user_presence
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- App admins can see all presence rows
CREATE POLICY "App admins can view all presence"
  ON public.user_presence
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'app_admin'::app_role));

-- Users can view their own presence
CREATE POLICY "Users can view own presence"
  ON public.user_presence
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Heartbeat RPC: upsert last_seen_at for the calling user
CREATE OR REPLACE FUNCTION public.heartbeat_presence(_platform TEXT DEFAULT NULL, _user_agent TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.user_presence (user_id, last_seen_at, platform, user_agent, updated_at)
  VALUES (auth.uid(), now(), _platform, _user_agent, now())
  ON CONFLICT (user_id) DO UPDATE
    SET last_seen_at = now(),
        platform = COALESCE(EXCLUDED.platform, public.user_presence.platform),
        user_agent = COALESCE(EXCLUDED.user_agent, public.user_presence.user_agent),
        updated_at = now();
END;
$$;
