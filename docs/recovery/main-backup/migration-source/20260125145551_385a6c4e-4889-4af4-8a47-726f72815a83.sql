-- Fix the RLS policy for club invite role assignment to use security definer function
DROP POLICY IF EXISTS "Users can add roles via valid club invite" ON public.user_roles;

CREATE POLICY "Users can add roles via valid club invite"
ON public.user_roles
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND club_id IS NOT NULL
  AND team_id IS NULL
  AND (
    -- Match by invited_user_id (if already set)
    EXISTS (
      SELECT 1 FROM pending_invites pi
      WHERE pi.club_id = user_roles.club_id
        AND pi.role = user_roles.role
        AND pi.team_id IS NULL
        AND pi.invited_user_id = auth.uid()
        AND pi.status = 'pending'
    )
    OR
    -- Match by email using security definer function (not direct auth.users access)
    EXISTS (
      SELECT 1 FROM pending_invites pi
      WHERE pi.club_id = user_roles.club_id
        AND pi.role = user_roles.role
        AND pi.team_id IS NULL
        AND pi.invited_email IS NOT NULL
        AND public.user_email_matches_invite(auth.uid(), pi.invited_email)
        AND pi.status = 'pending'
    )
    OR
    -- Grace period for recently accepted invites
    EXISTS (
      SELECT 1 FROM pending_invites pi
      WHERE pi.club_id = user_roles.club_id
        AND pi.role = user_roles.role
        AND pi.team_id IS NULL
        AND (
          pi.invited_user_id = auth.uid()
          OR public.user_email_matches_invite(auth.uid(), pi.invited_email)
        )
        AND pi.status = 'accepted'
        AND pi.accepted_at > now() - interval '2 minutes'
    )
  )
);