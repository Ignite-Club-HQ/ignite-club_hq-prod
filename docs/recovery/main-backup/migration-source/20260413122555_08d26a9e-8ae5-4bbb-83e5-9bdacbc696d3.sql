CREATE POLICY "Club admins can view child guardians in their clubs"
ON public.child_guardians
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.child_team_assignments cta
    JOIN public.teams t ON t.id = cta.team_id
    JOIN public.user_roles ur ON ur.club_id = t.club_id
    WHERE cta.child_id = child_guardians.child_id
      AND ur.user_id = auth.uid()
      AND ur.role = 'club_admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'app_admin'
  )
);