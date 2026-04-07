-- Fix: Allow club admins to view child_team_assignments for teams in their club
-- Previously the policy required user_roles.team_id to match, which excluded
-- club admins whose roles only have club_id set

DROP POLICY IF EXISTS "Team admins can manage assignments" ON child_team_assignments;

CREATE POLICY "Team admins can manage assignments"
ON child_team_assignments
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role, 'club_admin'::app_role])
    AND (
      user_roles.team_id = child_team_assignments.team_id
      OR user_roles.club_id IN (SELECT t.club_id FROM teams t WHERE t.id = child_team_assignments.team_id)
    )
  )
);