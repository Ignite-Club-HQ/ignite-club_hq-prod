-- Allow any team member to view pending invites for their own team
CREATE POLICY "Team members can view pending invites for their team"
ON public.pending_invites
FOR SELECT
TO authenticated
USING (
  team_id IS NOT NULL
  AND public.is_team_member(auth.uid(), team_id)
);