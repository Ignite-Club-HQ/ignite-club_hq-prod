-- Table to track user activity (page views and active time)
CREATE TABLE public.user_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  club_id uuid REFERENCES public.clubs(id) ON DELETE SET NULL,
  page_path text NOT NULL,
  page_label text,
  session_id text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  duration_seconds integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for efficient queries by user, club, and time
CREATE INDEX idx_user_activity_user_id ON public.user_activity_logs(user_id);
CREATE INDEX idx_user_activity_club_id ON public.user_activity_logs(club_id);
CREATE INDEX idx_user_activity_started_at ON public.user_activity_logs(started_at);
CREATE INDEX idx_user_activity_session ON public.user_activity_logs(session_id);

-- Enable RLS
ALTER TABLE public.user_activity_logs ENABLE ROW LEVEL SECURITY;

-- Users can insert their own activity
CREATE POLICY "Users can insert own activity"
  ON public.user_activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own activity (to update duration)
CREATE POLICY "Users can update own activity"
  ON public.user_activity_logs FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- App admins can read all activity
CREATE POLICY "App admins can read all activity"
  ON public.user_activity_logs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'app_admin'));