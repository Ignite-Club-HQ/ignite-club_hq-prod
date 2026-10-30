-- Add policy to allow viewing profiles of photo uploaders in shared clubs/teams
-- This enables showing uploader names/avatars on the media page

CREATE POLICY "Users can view profiles of photo uploaders in shared clubs/teams"
ON public.profiles
FOR SELECT
USING (
  id IN (
    SELECT DISTINCT p.uploader_id 
    FROM photos p
    WHERE p.deleted_at IS NULL
    AND (
      -- User has access to the photo's club
      p.club_id IN (
        SELECT ur.club_id FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.club_id IS NOT NULL
      )
      OR
      -- User has access to the photo's team
      p.team_id IN (
        SELECT ur.team_id FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.team_id IS NOT NULL
      )
    )
  )
);