-- Add policy to allow viewing profiles of photo comment authors in shared clubs/teams
-- This enables showing commenter names/avatars on the media page

CREATE POLICY "Users can view profiles of photo commenters in shared clubs/teams"
ON public.profiles
FOR SELECT
USING (
  id IN (
    SELECT DISTINCT pc.user_id 
    FROM photo_comments pc
    JOIN photos p ON p.id = pc.photo_id
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