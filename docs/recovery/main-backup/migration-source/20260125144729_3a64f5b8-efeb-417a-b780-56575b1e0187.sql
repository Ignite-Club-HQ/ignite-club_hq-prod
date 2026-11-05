-- Add SELECT policy for club admins to view pending invites in their club
CREATE POLICY "Club admins can view club pending invites"
ON public.pending_invites
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND user_roles.club_id = pending_invites.club_id
      AND user_roles.role = 'club_admin'::app_role
  )
);