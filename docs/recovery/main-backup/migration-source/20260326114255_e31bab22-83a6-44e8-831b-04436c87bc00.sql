
-- Allow any team member to view child_guardians for children on their teams
CREATE POLICY "Team members can view child guardians on their teams"
ON public.child_guardians
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM child_team_assignments cta
    JOIN user_roles ur ON ur.team_id = cta.team_id
    WHERE cta.child_id = child_guardians.child_id
      AND ur.user_id = auth.uid()
  )
);
