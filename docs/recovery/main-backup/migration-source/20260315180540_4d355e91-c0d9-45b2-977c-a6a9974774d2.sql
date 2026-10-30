
CREATE TABLE public.points_cooldowns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  awarded_date DATE NOT NULL DEFAULT CURRENT_DATE,
  points_awarded INTEGER NOT NULL DEFAULT 0,
  club_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for fast cooldown lookups
CREATE INDEX idx_points_cooldowns_lookup ON public.points_cooldowns (user_id, action_type, scope_id, awarded_date);

-- Index for daily cap checks
CREATE INDEX idx_points_cooldowns_daily_cap ON public.points_cooldowns (user_id, action_type, awarded_date);

-- Unique constraint to prevent duplicate awards
CREATE UNIQUE INDEX idx_points_cooldowns_unique ON public.points_cooldowns (user_id, action_type, scope_id, awarded_date);

-- Enable RLS
ALTER TABLE public.points_cooldowns ENABLE ROW LEVEL SECURITY;

-- Users can read their own cooldowns
CREATE POLICY "Users can read own cooldowns"
  ON public.points_cooldowns
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own cooldowns
CREATE POLICY "Users can insert own cooldowns"
  ON public.points_cooldowns
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
