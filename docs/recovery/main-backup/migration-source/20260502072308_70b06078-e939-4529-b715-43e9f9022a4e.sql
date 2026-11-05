CREATE POLICY "Team staff can view club pending invites"
ON public.pending_invites
FOR SELECT
TO authenticated
USING (
  club_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.club_id = pending_invites.club_id
      AND ur.role IN ('team_admin'::app_role, 'coach'::app_role, 'club_admin'::app_role)
  )
);