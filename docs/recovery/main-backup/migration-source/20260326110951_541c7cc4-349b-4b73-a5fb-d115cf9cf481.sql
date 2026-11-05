-- Allow all team members (including parents) to view child_team_assignments for their team
CREATE POLICY "Team members can view assignments on their team"
ON public.child_team_assignments
FOR SELECT
TO authenticated
USING (
  public.is_team_member(auth.uid(), team_id)
);