-- Drop the overly permissive INSERT policy
DROP POLICY IF EXISTS "Authenticated users can insert points history" ON public.points_history;

-- Only admins/coaches can insert points history, and created_by must be the current user
CREATE POLICY "Admins and coaches can insert points history" ON public.points_history
FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (
    -- App admin
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role = 'app_admin'
    )
    -- Club admin or team admin for the target club
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.club_id = points_history.club_id
      AND ur.role IN ('club_admin', 'team_admin', 'coach')
    )
  )
);