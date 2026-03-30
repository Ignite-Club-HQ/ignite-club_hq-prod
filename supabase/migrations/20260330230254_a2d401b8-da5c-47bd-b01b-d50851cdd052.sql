-- Drop the existing insert policy
DROP POLICY IF EXISTS "Team members can send team messages" ON public.team_messages;

-- Create a new insert policy that also allows club admins and app admins
-- to insert messages (needed for club announcements to teams they don't belong to)
CREATE POLICY "Team members can send team messages"
ON public.team_messages
FOR INSERT
TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND (
    -- Regular team members
    is_team_member(auth.uid(), team_id)
    -- Club admins can send to any team in their club (for announcements)
    OR EXISTS (
      SELECT 1 FROM teams t
      WHERE t.id = team_messages.team_id
      AND has_role(auth.uid(), 'club_admin'::app_role, t.club_id, NULL::uuid)
    )
    -- App admins can send to any team
    OR has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
  )
);