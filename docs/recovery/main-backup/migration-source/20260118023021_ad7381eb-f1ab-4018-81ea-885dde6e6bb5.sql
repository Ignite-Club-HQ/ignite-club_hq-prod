-- Allow users to add roles to themselves when joining via a valid team invite link
-- This handles the case where a new user joins a team via invite and gets team_admin or other roles
CREATE POLICY "Users can add roles via valid team invite" 
ON public.user_roles
FOR INSERT
WITH CHECK (
  -- Must be adding role to themselves
  user_id = auth.uid()
  AND team_id IS NOT NULL
  AND (
    -- There's a valid team invite for this team with this role
    EXISTS (
      SELECT 1 FROM public.team_invites ti
      WHERE ti.team_id = user_roles.team_id
        AND ti.role = user_roles.role
        AND (ti.expires_at IS NULL OR ti.expires_at > now())
        AND (ti.max_uses IS NULL OR ti.uses_count < ti.max_uses)
    )
    OR
    -- OR there's a pending invite specifically for this user to this team
    EXISTS (
      SELECT 1 FROM public.pending_invites pi
      WHERE pi.team_id = user_roles.team_id
        AND pi.role = user_roles.role
        AND pi.invited_user_id = auth.uid()
        AND pi.status = 'pending'
    )
    OR
    -- OR there's a matching pending invite that was just accepted (within last minute to handle race condition)
    EXISTS (
      SELECT 1 FROM public.pending_invites pi
      WHERE pi.team_id = user_roles.team_id
        AND pi.role = user_roles.role
        AND pi.invited_user_id = auth.uid()
        AND pi.status = 'accepted'
        AND pi.accepted_at > now() - interval '1 minute'
    )
  )
);