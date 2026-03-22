
-- Create club_join_requests table for users requesting to join existing clubs
CREATE TABLE public.club_join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(club_id, user_id)
);

-- Enable RLS
ALTER TABLE public.club_join_requests ENABLE ROW LEVEL SECURITY;

-- Users can view their own requests
CREATE POLICY "Users can view own join requests"
  ON public.club_join_requests FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Club admins can view requests for their clubs
CREATE POLICY "Club admins can view join requests"
  ON public.club_join_requests FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.club_id = club_join_requests.club_id
      AND ur.role IN ('club_admin', 'app_admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role = 'app_admin'
    )
  );

-- Users can insert their own requests
CREATE POLICY "Users can create join requests"
  ON public.club_join_requests FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Club admins can update (approve/reject) requests
CREATE POLICY "Club admins can update join requests"
  ON public.club_join_requests FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.club_id = club_join_requests.club_id
      AND ur.role IN ('club_admin', 'app_admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role = 'app_admin'
    )
  );

-- Add updated_at trigger
CREATE TRIGGER update_club_join_requests_updated_at
  BEFORE UPDATE ON public.club_join_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
