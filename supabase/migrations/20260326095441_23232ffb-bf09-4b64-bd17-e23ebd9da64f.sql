-- Allow admins (team_admin, coach, club_admin, app_admin) to INSERT children on behalf of parents
CREATE POLICY "Admins can create children for team members"
ON public.children
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role IN ('team_admin', 'coach', 'club_admin', 'app_admin')
  )
);

-- Also allow admins to UPDATE children they can view (e.g. updating year_of_birth)
CREATE POLICY "Admins can update children on their teams"
ON public.children
FOR UPDATE
TO authenticated
USING (can_admin_view_child(id, auth.uid()))
WITH CHECK (can_admin_view_child(id, auth.uid()));