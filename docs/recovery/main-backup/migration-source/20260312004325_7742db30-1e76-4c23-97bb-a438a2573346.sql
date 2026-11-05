
-- Drop the overly permissive public SELECT policy
DROP POLICY IF EXISTS "Public can view match status" ON public.business_matches;

-- Allow SELECT for club admins of the matched club
CREATE POLICY "Club admins can view their matches" ON public.business_matches
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.club_id = business_matches.club_id
    AND ur.role IN ('club_admin', 'app_admin')
  )
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role = 'app_admin'
  )
  OR EXISTS (
    SELECT 1 FROM public.business_profiles bp
    WHERE bp.id = business_matches.business_profile_id
    AND bp.user_id = auth.uid()
  )
);
