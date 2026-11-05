-- Drop existing policy
DROP POLICY IF EXISTS "Users can add roles via valid team invite" ON user_roles;

-- Create updated policy that allows:
-- 1. Adding the exact role from a team_invite
-- 2. Adding coach/player/parent roles when ANY valid team_invite exists for that team
-- 3. Adding roles from pending_invites
CREATE POLICY "Users can add roles via valid team invite" ON user_roles
FOR INSERT
WITH CHECK (
  (user_id = auth.uid()) 
  AND (team_id IS NOT NULL) 
  AND (
    -- Allow exact role match from team_invites
    EXISTS (
      SELECT 1 FROM team_invites ti
      WHERE ti.team_id = user_roles.team_id
        AND ti.role = user_roles.role
        AND (ti.expires_at IS NULL OR ti.expires_at > now())
        AND (ti.max_uses IS NULL OR ti.uses_count < ti.max_uses)
    )
    -- Allow coach/player/parent roles when a valid team_invite exists (any role)
    OR (
      user_roles.role IN ('coach', 'player', 'parent')
      AND EXISTS (
        SELECT 1 FROM team_invites ti
        WHERE ti.team_id = user_roles.team_id
          AND (ti.expires_at IS NULL OR ti.expires_at > now())
          AND (ti.max_uses IS NULL OR ti.uses_count < ti.max_uses)
      )
    )
    -- Allow from pending_invites where user is invited
    OR EXISTS (
      SELECT 1 FROM pending_invites pi
      WHERE pi.team_id = user_roles.team_id
        AND pi.role = user_roles.role
        AND pi.invited_user_id = auth.uid()
        AND pi.status = 'pending'
    )
    -- Allow from recently accepted pending_invites (2 minute grace period)
    OR EXISTS (
      SELECT 1 FROM pending_invites pi
      WHERE pi.team_id = user_roles.team_id
        AND pi.role = user_roles.role
        AND pi.invited_user_id = auth.uid()
        AND pi.status = 'accepted'
        AND pi.accepted_at > now() - interval '2 minutes'
    )
    -- Allow from pending_invites with invite_token (for team admin invite links)
    OR EXISTS (
      SELECT 1 FROM pending_invites pi
      WHERE pi.team_id = user_roles.team_id
        AND pi.role = user_roles.role
        AND pi.invite_token IS NOT NULL
        AND pi.status = 'pending'
    )
  )
);