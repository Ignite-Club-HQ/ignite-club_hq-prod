-- Drop the existing policy
DROP POLICY IF EXISTS "Team admins can manage invites" ON public.team_invites;

-- Create a new policy that also allows club admins to manage team invites
-- This covers the case where a club admin creates a team and generates an invite link
CREATE POLICY "Team and club admins can manage invites" 
ON public.team_invites
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND (
      -- Direct team role access
      (user_roles.team_id = team_invites.team_id AND user_roles.role IN ('team_admin', 'coach', 'club_admin'))
      OR
      -- Club admin creating invites for any team in their club
      (user_roles.role = 'club_admin' AND user_roles.club_id = (
        SELECT club_id FROM teams WHERE teams.id = team_invites.team_id
      ))
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND (
      -- Direct team role access
      (user_roles.team_id = team_invites.team_id AND user_roles.role IN ('team_admin', 'coach', 'club_admin'))
      OR
      -- Club admin creating invites for any team in their club
      (user_roles.role = 'club_admin' AND user_roles.club_id = (
        SELECT club_id FROM teams WHERE teams.id = team_invites.team_id
      ))
    )
  )
);