
-- Drop and recreate team_invites policy to also allow team creators to create invites
-- This fixes the issue where a club admin creates a team and assigns someone else as admin via invite link
DROP POLICY IF EXISTS "Team and club admins can manage invites" ON public.team_invites;

CREATE POLICY "Team and club admins can manage invites"
ON public.team_invites
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND (
      -- User is team_admin, coach, or club_admin for this team directly
      (ur.team_id = team_invites.team_id AND ur.role IN ('team_admin', 'coach', 'club_admin'))
      OR
      -- User is club_admin for the team's club
      (ur.role = 'club_admin' AND ur.club_id = (SELECT t.club_id FROM public.teams t WHERE t.id = team_invites.team_id))
      OR
      -- User is app_admin
      ur.role = 'app_admin'
    )
  )
  OR
  -- Allow team creator to manage invites (critical for create team + invite link flow)
  EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = team_invites.team_id AND t.created_by = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND (
      -- User is team_admin, coach, or club_admin for this team directly
      (ur.team_id = team_invites.team_id AND ur.role IN ('team_admin', 'coach', 'club_admin'))
      OR
      -- User is club_admin for the team's club
      (ur.role = 'club_admin' AND ur.club_id = (SELECT t.club_id FROM public.teams t WHERE t.id = team_invites.team_id))
      OR
      -- User is app_admin
      ur.role = 'app_admin'
    )
  )
  OR
  -- Allow team creator to create invites (critical for create team + invite link flow)
  EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = team_invites.team_id AND t.created_by = auth.uid()
  )
);
