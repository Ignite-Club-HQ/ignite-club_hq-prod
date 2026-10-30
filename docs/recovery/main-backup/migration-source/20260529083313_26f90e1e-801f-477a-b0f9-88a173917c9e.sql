CREATE OR REPLACE FUNCTION public.can_view_message_read(_user_id uuid, _team_message_id uuid, _club_message_id uuid, _broadcast_message_id uuid, _group_message_id uuid, _direct_message_id uuid, _club_admin_message_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    _user_id = (SELECT auth.uid())
    OR
    (_team_message_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM team_messages tm
      JOIN user_roles ur ON ur.team_id = tm.team_id AND ur.user_id = (SELECT auth.uid())
      WHERE tm.id = _team_message_id
    ))
    OR
    (_club_message_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM club_messages cm
      JOIN user_roles ur ON ur.club_id = cm.club_id AND ur.user_id = (SELECT auth.uid())
      WHERE cm.id = _club_message_id
    ))
    OR
    (_broadcast_message_id IS NOT NULL)
    OR
    -- Group message: viewer must have access to the group (handles manual-mode
    -- groups with empty allowed_roles, where the previous role-array check
    -- always failed — even for the message author).
    (_group_message_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM group_messages gm
      WHERE gm.id = _group_message_id
        AND public.can_access_chat_group(gm.group_id, (SELECT auth.uid()))
    ))
    OR
    (_direct_message_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM direct_messages dm
      JOIN direct_conversations dc ON dc.id = dm.conversation_id
      WHERE dm.id = _direct_message_id
        AND (dc.participant_1 = (SELECT auth.uid()) OR dc.participant_2 = (SELECT auth.uid()))
    ))
    OR
    (_club_admin_message_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM club_admin_messages cam
      JOIN club_admin_conversations cac ON cac.id = cam.conversation_id
      WHERE cam.id = _club_admin_message_id
        AND (
          cac.member_user_id = (SELECT auth.uid())
          OR EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = (SELECT auth.uid())
              AND ur.club_id = cac.club_id
              AND ur.role = 'club_admin'
          )
        )
    ))
$function$;