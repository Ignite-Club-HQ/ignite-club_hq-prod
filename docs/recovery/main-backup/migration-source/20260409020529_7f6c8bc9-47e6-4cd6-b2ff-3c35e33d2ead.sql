
DROP POLICY IF EXISTS "Club members and team members can send club messages" ON public.club_messages;

CREATE POLICY "Club members and team members can send club messages"
ON public.club_messages
FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
  OR has_role(auth.uid(), 'club_admin'::app_role, club_id, NULL::uuid)
  OR has_role(auth.uid(), 'committee_member'::app_role, club_id, NULL::uuid)
  OR (EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN teams t ON t.id = ur.team_id
    WHERE ur.user_id = auth.uid()
      AND t.club_id = club_messages.club_id
  ))
);
