-- Drop the overly permissive public SELECT policy
DROP POLICY IF EXISTS "Match participants can view messages" ON public.match_messages;

-- Restrict to authenticated users who are participants of the match
CREATE POLICY "Match participants can view messages" ON public.match_messages
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.business_matches bm
    WHERE bm.id = match_messages.match_id
    AND (
      -- Club admin of the matched club
      EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
        AND ur.club_id = bm.club_id
        AND ur.role IN ('club_admin', 'app_admin')
      )
      -- Sponsor who owns the business profile
      OR EXISTS (
        SELECT 1 FROM public.business_profiles bp
        WHERE bp.id = bm.business_profile_id
        AND bp.user_id = auth.uid()
      )
      -- App admin
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
        AND ur.role = 'app_admin'
      )
    )
  )
);