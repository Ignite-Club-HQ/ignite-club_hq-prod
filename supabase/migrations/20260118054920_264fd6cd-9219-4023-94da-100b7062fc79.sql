-- Drop existing policy that's too restrictive for new users with invite tokens
DROP POLICY IF EXISTS "Users can add roles via valid team invite" ON public.user_roles;

-- Create updated policy that also allows joining via pending invite token
-- This fixes the issue where new users with invite links can't join because
-- the pending_invite.invited_user_id was set to the inviter, not the new user
CREATE POLICY "Users can add roles via valid team invite"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid() 
  AND team_id IS NOT NULL
  AND (
    -- Valid team_invite exists for this team/role
    EXISTS (
      SELECT 1 FROM public.team_invites ti
      WHERE ti.team_id = user_roles.team_id
        AND ti.role = user_roles.role
        AND (ti.expires_at IS NULL OR ti.expires_at > now())
        AND (ti.max_uses IS NULL OR ti.uses_count < ti.max_uses)
    )
    OR
    -- Pending invite specifically for this user (by user_id)
    EXISTS (
      SELECT 1 FROM public.pending_invites pi
      WHERE pi.team_id = user_roles.team_id
        AND pi.role = user_roles.role
        AND pi.invited_user_id = auth.uid()
        AND pi.status = 'pending'
    )
    OR
    -- Pending invite that was just accepted (handles race condition)
    EXISTS (
      SELECT 1 FROM public.pending_invites pi
      WHERE pi.team_id = user_roles.team_id
        AND pi.role = user_roles.role
        AND pi.invited_user_id = auth.uid()
        AND pi.status = 'accepted'
        AND pi.accepted_at > now() - interval '2 minutes'
    )
    OR
    -- ANY pending invite with a token for this team/role that's still pending
    -- This allows new users to claim roles via invite tokens
    -- The invite will be marked accepted by the app code
    EXISTS (
      SELECT 1 FROM public.pending_invites pi
      WHERE pi.team_id = user_roles.team_id
        AND pi.role = user_roles.role
        AND pi.invite_token IS NOT NULL
        AND pi.status = 'pending'
    )
  )
);