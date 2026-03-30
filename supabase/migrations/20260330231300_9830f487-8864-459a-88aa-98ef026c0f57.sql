-- Update SELECT policy to also allow club admins and app admins to view team messages
DROP POLICY IF EXISTS "Team members can view team messages" ON public.team_messages;

CREATE POLICY "Team members can view team messages"
ON public.team_messages
FOR SELECT
TO authenticated
USING (
  is_team_member(auth.uid(), team_id)
  OR EXISTS (
    SELECT 1 FROM teams t
    WHERE t.id = team_messages.team_id
    AND has_role(auth.uid(), 'club_admin'::app_role, t.club_id, NULL::uuid)
  )
  OR has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
);