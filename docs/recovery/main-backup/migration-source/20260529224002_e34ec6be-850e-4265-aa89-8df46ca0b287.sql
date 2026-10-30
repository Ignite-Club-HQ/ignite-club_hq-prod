DROP POLICY IF EXISTS "Users can view reactions on accessible messages" ON public.message_reactions;

CREATE POLICY "Users can view reactions on accessible messages"
ON public.message_reactions
FOR SELECT
USING (
  ((team_message_id IS NOT NULL) AND (EXISTS (
    SELECT 1 FROM team_messages tm
    WHERE tm.id = message_reactions.team_message_id
      AND is_team_member((SELECT auth.uid()), tm.team_id)
  )))
  OR ((club_message_id IS NOT NULL) AND (EXISTS (
    SELECT 1 FROM club_messages cm
    WHERE cm.id = message_reactions.club_message_id
      AND is_club_member((SELECT auth.uid()), cm.club_id)
  )))
  OR ((broadcast_message_id IS NOT NULL) AND ((SELECT auth.uid()) IS NOT NULL))
  OR ((group_message_id IS NOT NULL) AND (EXISTS (
    SELECT 1 FROM group_messages gm
    WHERE gm.id = message_reactions.group_message_id
      AND can_access_chat_group((SELECT auth.uid()), gm.group_id)
  )))
  OR ((direct_message_id IS NOT NULL) AND (EXISTS (
    SELECT 1 FROM direct_messages dm
    JOIN direct_conversations dc ON dc.id = dm.conversation_id
    WHERE dm.id = message_reactions.direct_message_id
      AND (dc.participant_1 = (SELECT auth.uid()) OR dc.participant_2 = (SELECT auth.uid()))
  )))
  OR ((club_admin_message_id IS NOT NULL) AND (EXISTS (
    SELECT 1 FROM club_admin_messages cam
    WHERE cam.id = message_reactions.club_admin_message_id
      AND is_club_admin_conversation_participant(cam.conversation_id)
  )))
  OR has_role((SELECT auth.uid()), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
);