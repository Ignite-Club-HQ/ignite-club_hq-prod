-- Update the RLS policy for viewing message reactions to include direct messages
DROP POLICY IF EXISTS "Users can view reactions on accessible messages" ON public.message_reactions;

CREATE POLICY "Users can view reactions on accessible messages"
ON public.message_reactions
FOR SELECT
USING (
  -- Team messages: user must be team member
  (team_message_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM team_messages tm
    WHERE tm.id = message_reactions.team_message_id
    AND is_team_member(auth.uid(), tm.team_id)
  ))
  OR
  -- Club messages: user must be club member
  (club_message_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM club_messages cm
    WHERE cm.id = message_reactions.club_message_id
    AND is_club_member(auth.uid(), cm.club_id)
  ))
  OR
  -- Broadcast messages: any authenticated user
  (broadcast_message_id IS NOT NULL AND auth.uid() IS NOT NULL)
  OR
  -- Group messages: user must have access to the group
  (group_message_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM group_messages gm
    WHERE gm.id = message_reactions.group_message_id
    AND can_access_chat_group(auth.uid(), gm.group_id)
  ))
  OR
  -- Direct messages: user must be a participant in the conversation
  (direct_message_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM direct_messages dm
    JOIN direct_conversations dc ON dc.id = dm.conversation_id
    WHERE dm.id = message_reactions.direct_message_id
    AND (dc.participant_1 = auth.uid() OR dc.participant_2 = auth.uid())
  ))
  OR
  -- App admins can see all
  has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
);