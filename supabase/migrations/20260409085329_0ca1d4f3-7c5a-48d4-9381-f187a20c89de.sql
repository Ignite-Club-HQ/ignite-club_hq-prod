
-- Create member_referrals table
CREATE TABLE public.member_referrals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  referred_by UUID NOT NULL,
  referred_name TEXT NOT NULL,
  referred_email TEXT,
  referred_phone TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  reject_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.member_referrals ENABLE ROW LEVEL SECURITY;

-- Members can create referrals for teams they belong to
CREATE POLICY "Members can create referrals for their teams"
ON public.member_referrals
FOR INSERT
TO authenticated
WITH CHECK (
  referred_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND team_id = member_referrals.team_id
  )
);

-- Members can view their own referrals
CREATE POLICY "Members can view own referrals"
ON public.member_referrals
FOR SELECT
TO authenticated
USING (referred_by = auth.uid());

-- Admins/coaches/team_admins can view all referrals for their teams
CREATE POLICY "Admins can view team referrals"
ON public.member_referrals
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND team_id = member_referrals.team_id
      AND role IN ('club_admin', 'coach', 'team_admin')
  )
);

-- Admins/coaches/team_admins can update referrals (approve/reject)
CREATE POLICY "Admins can update team referrals"
ON public.member_referrals
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND team_id = member_referrals.team_id
      AND role IN ('club_admin', 'coach', 'team_admin')
  )
);

-- Trigger for updated_at
CREATE TRIGGER update_member_referrals_updated_at
BEFORE UPDATE ON public.member_referrals
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
