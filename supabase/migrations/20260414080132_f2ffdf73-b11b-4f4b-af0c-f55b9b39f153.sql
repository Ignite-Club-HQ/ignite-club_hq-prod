
-- Security definer function to check if a user can view a message_read row
CREATE OR REPLACE FUNCTION public.can_view_message_read(
  _user_id uuid,
  _team_message_id uuid,
  _club_message_id uuid,
  _broadcast_message_id uuid,
  _group_message_id uuid,
  _direct_message_id uuid,
  _club_admin_message_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- User can always see their own reads
    _user_id = auth.uid()
    OR
    -- Team message: user has a role in that team
    (_team_message_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM team_messages tm
      JOIN user_roles ur ON ur.team_id = tm.team_id AND ur.user_id = auth.uid()
      WHERE tm.id = _team_message_id
    ))
    OR
    -- Club message: user has a role in that club
    (_club_message_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM club_messages cm
      JOIN user_roles ur ON ur.club_id = cm.club_id AND ur.user_id = auth.uid()
      WHERE cm.id = _club_message_id
    ))
    OR
    -- Broadcast message: any authenticated user (broadcasts are global)
    (_broadcast_message_id IS NOT NULL)
    OR
    -- Group message: user has a role matching the group's allowed roles
    (_group_message_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM group_messages gm
      JOIN chat_groups cg ON cg.id = gm.group_id
      JOIN user_roles ur ON ur.user_id = auth.uid()
        AND (
          (cg.team_id IS NOT NULL AND ur.team_id = cg.team_id)
          OR (cg.club_id IS NOT NULL AND ur.club_id = cg.club_id)
        )
        AND ur.role = ANY(cg.allowed_roles)
      WHERE gm.id = _group_message_id
    ))
    OR
    -- Direct message: user is a participant
    (_direct_message_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM direct_messages dm
      JOIN direct_conversations dc ON dc.id = dm.conversation_id
      WHERE dm.id = _direct_message_id
        AND (dc.participant_1 = auth.uid() OR dc.participant_2 = auth.uid())
    ))
    OR
    -- Club admin message: user is a club admin or the member in the conversation
    (_club_admin_message_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM club_admin_messages cam
      JOIN club_admin_conversations cac ON cac.id = cam.conversation_id
      WHERE cam.id = _club_admin_message_id
        AND (
          cac.member_user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.club_id = cac.club_id
              AND ur.role = 'club_admin'
          )
        )
    ))
$$;

-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Authenticated users can view message reads" ON public.message_reads;

-- Create scoped policy
CREATE POLICY "Users can view message reads in their threads"
ON public.message_reads
FOR SELECT
TO authenticated
USING (
  public.can_view_message_read(
    user_id,
    team_message_id,
    club_message_id,
    broadcast_message_id,
    group_message_id,
    direct_message_id,
    club_admin_message_id
  )
);
