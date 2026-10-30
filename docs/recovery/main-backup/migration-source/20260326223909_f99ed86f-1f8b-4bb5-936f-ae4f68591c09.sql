
-- Team creation requests table for non-admin users
CREATE TABLE public.team_creation_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  level_age TEXT,
  description TEXT,
  logo_url TEXT,
  team_type TEXT DEFAULT 'mixed',
  folder_id UUID,
  class_day TEXT,
  class_time TEXT,
  class_duration_minutes INTEGER,
  class_capacity INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.team_creation_requests ENABLE ROW LEVEL SECURITY;

-- Requesters can view their own requests
CREATE POLICY "Users can view own requests"
  ON public.team_creation_requests FOR SELECT
  TO authenticated
  USING (requested_by = auth.uid());

-- Club admins can view requests for their club
CREATE POLICY "Club admins can view club requests"
  ON public.team_creation_requests FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.club_id = team_creation_requests.club_id
      AND ur.role IN ('club_admin', 'app_admin')
    )
    OR public.has_role(auth.uid(), 'app_admin')
  );

-- Any authenticated user can insert
CREATE POLICY "Authenticated users can create requests"
  ON public.team_creation_requests FOR INSERT
  TO authenticated
  WITH CHECK (requested_by = auth.uid());

-- Club admins can update (approve/reject)
CREATE POLICY "Club admins can update requests"
  ON public.team_creation_requests FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.club_id = team_creation_requests.club_id
      AND ur.role IN ('club_admin', 'app_admin')
    )
    OR public.has_role(auth.uid(), 'app_admin')
  );

-- Updated_at trigger
CREATE TRIGGER update_team_creation_requests_updated_at
  BEFORE UPDATE ON public.team_creation_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
