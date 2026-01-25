-- Add RLS policy to allow users to add roles via valid CLUB invites (pending_invites)
-- This handles club_admin invites that don't have a team_id

CREATE POLICY "Users can add roles via valid club invite"
ON public.user_roles
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND club_id IS NOT NULL
  AND team_id IS NULL
  AND (
    -- Match by invited_user_id if set
    EXISTS (
      SELECT 1 FROM pending_invites pi
      WHERE pi.club_id = user_roles.club_id
        AND pi.role = user_roles.role
        AND pi.team_id IS NULL
        AND pi.invited_user_id = auth.uid()
        AND pi.status = 'pending'
    )
    -- Or match by email (for new users where invited_user_id wasn't set yet)
    OR EXISTS (
      SELECT 1 FROM pending_invites pi
      JOIN auth.users au ON LOWER(au.email) = LOWER(pi.invited_email)
      WHERE pi.club_id = user_roles.club_id
        AND pi.role = user_roles.role
        AND pi.team_id IS NULL
        AND au.id = auth.uid()
        AND pi.status = 'pending'
    )
    -- Or match recently accepted invite (within 2 minutes)
    OR EXISTS (
      SELECT 1 FROM pending_invites pi
      WHERE pi.club_id = user_roles.club_id
        AND pi.role = user_roles.role
        AND pi.team_id IS NULL
        AND pi.invited_user_id = auth.uid()
        AND pi.status = 'accepted'
        AND pi.accepted_at > now() - interval '2 minutes'
    )
  )
);