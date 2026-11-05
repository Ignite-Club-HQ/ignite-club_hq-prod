DROP POLICY IF EXISTS "Admins can create children for team members" ON public.children;
CREATE POLICY "Admins can create children for team members"
ON public.children
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = (SELECT auth.uid())
      AND ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role, 'club_admin'::app_role, 'app_admin'::app_role, 'league_admin'::app_role])
  )
);