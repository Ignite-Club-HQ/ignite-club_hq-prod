-- Allow admins to insert child_guardians on behalf of parents
CREATE POLICY "Admins can insert child guardians for their teams"
ON public.child_guardians
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role IN ('team_admin', 'coach', 'club_admin', 'app_admin')
  )
);