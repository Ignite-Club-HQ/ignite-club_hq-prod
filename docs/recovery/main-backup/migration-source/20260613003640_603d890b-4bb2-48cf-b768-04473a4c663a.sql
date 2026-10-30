DROP POLICY IF EXISTS "Users can view reactions on accessible messages" ON public.message_reactions;

CREATE POLICY "Users can view reactions on accessible messages"
ON public.message_reactions
FOR SELECT
USING (
  (
    team_message_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.team_messages tm
      WHERE tm.id = message_reactions.team_message_id
        AND (
          public.is_team_member((SELECT auth.uid()), tm.team_id)
          OR EXISTS (
            SELECT 1
            FROM public.teams t
            WHERE t.id = tm.team_id
              AND public.has_role((SELECT auth.uid()), 'club_admin'::public.app_role, t.club_id, NULL::uuid)
          )
        )
    )
  )
  OR (
    club_message_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.club_messages cm
      WHERE cm.id = message_reactions.club_message_id
        AND public.is_club_member((SELECT auth.uid()), cm.club_id)
    )
  )
  OR (
    broadcast_message_id IS NOT NULL
    AND (SELECT auth.uid()) IS NOT NULL
  )
  OR (
    group_message_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.group_messages gm
      WHERE gm.id = message_reactions.group_message_id
        AND public.can_access_chat_group((SELECT auth.uid()), gm.group_id)
    )
  )
  OR (
    direct_message_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.direct_messages dm
      JOIN public.direct_conversations dc ON dc.id = dm.conversation_id
      WHERE dm.id = message_reactions.direct_message_id
        AND (
          dc.participant_1 = (SELECT auth.uid())
          OR dc.participant_2 = (SELECT auth.uid())
        )
    )
  )
  OR (
    club_admin_message_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.club_admin_messages cam
      WHERE cam.id = message_reactions.club_admin_message_id
        AND public.is_club_admin_conversation_participant(cam.conversation_id)
    )
  )
  OR public.has_role((SELECT auth.uid()), 'app_admin'::public.app_role, NULL::uuid, NULL::uuid)
);