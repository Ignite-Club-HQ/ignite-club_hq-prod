-- Create points_history table for complete audit trail
CREATE TABLE public.points_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  child_id UUID REFERENCES public.children(id) ON DELETE CASCADE,
  club_id UUID REFERENCES public.clubs(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_id UUID,
  description TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  
  CONSTRAINT points_history_user_or_child CHECK (
    (user_id IS NOT NULL AND child_id IS NULL) OR 
    (user_id IS NULL AND child_id IS NOT NULL)
  )
);

-- Create indexes for efficient querying
CREATE INDEX idx_points_history_user_id ON public.points_history(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_points_history_child_id ON public.points_history(child_id) WHERE child_id IS NOT NULL;
CREATE INDEX idx_points_history_club_id ON public.points_history(club_id) WHERE club_id IS NOT NULL;
CREATE INDEX idx_points_history_created_at ON public.points_history(created_at DESC);
CREATE INDEX idx_points_history_source_type ON public.points_history(source_type);

-- Enable RLS
ALTER TABLE public.points_history ENABLE ROW LEVEL SECURITY;

-- Users can view their own points history
CREATE POLICY "Users can view own points history"
ON public.points_history FOR SELECT
USING (
  auth.uid() = user_id
  OR auth.uid() IN (SELECT parent_id FROM public.children WHERE id = child_id)
);

-- Admins can view points history for their club members
CREATE POLICY "Admins can view club member points history"
ON public.points_history FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.club_id = points_history.club_id
    AND ur.role IN ('club_admin', 'team_admin', 'app_admin')
  )
);

-- App admins can view all points history
CREATE POLICY "App admins can view all points history"
ON public.points_history FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'app_admin'
  )
);

-- Allow inserts from authenticated users (system will handle validation)
CREATE POLICY "Authenticated users can insert points history"
ON public.points_history FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- Add comment for documentation
COMMENT ON TABLE public.points_history IS 'Audit trail for all Ignite points transactions - awards and redemptions';