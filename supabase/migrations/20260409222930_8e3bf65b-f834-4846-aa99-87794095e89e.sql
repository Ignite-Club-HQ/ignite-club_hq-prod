
-- Function to dismiss pending invites for users who already joined the team
CREATE OR REPLACE FUNCTION public.dismiss_accepted_pending_invites(p_team_id uuid DEFAULT NULL, p_club_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dismissed_count integer;
BEGIN
  -- Mark pending invites as accepted where the user already has a role on the team
  UPDATE pending_invites pi
  SET status = 'accepted',
      accepted_at = now()
  WHERE pi.status = 'pending'
    AND (
      (p_team_id IS NOT NULL AND pi.team_id = p_team_id)
      OR (p_club_id IS NOT NULL AND p_team_id IS NULL AND pi.club_id = p_club_id)
    )
    AND (
      -- Match by invited_user_id already having a role
      (pi.invited_user_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM user_roles ur
        WHERE ur.user_id = pi.invited_user_id
          AND (p_team_id IS NULL OR ur.team_id = p_team_id)
          AND (p_club_id IS NULL OR ur.club_id = p_club_id)
      ))
      OR
      -- Match by email against auth.users -> user_roles
      (pi.invited_email IS NOT NULL AND EXISTS (
        SELECT 1 FROM auth.users au
        JOIN user_roles ur ON ur.user_id = au.id
        WHERE lower(au.email) = lower(pi.invited_email)
          AND (p_team_id IS NULL OR ur.team_id = p_team_id)
          AND (p_club_id IS NULL OR ur.club_id = p_club_id)
      ))
    );

  GET DIAGNOSTICS dismissed_count = ROW_COUNT;
  RETURN dismissed_count;
END;
$$;
