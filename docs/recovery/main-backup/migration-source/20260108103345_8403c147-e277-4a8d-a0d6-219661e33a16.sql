-- Drop existing insert policy
DROP POLICY IF EXISTS "Members can upload photos" ON public.photos;

-- Create new insert policy that properly handles NULL team_id
CREATE POLICY "Members can upload photos" 
ON public.photos 
FOR INSERT 
WITH CHECK (
  auth.uid() IS NOT NULL
  AND uploader_id = auth.uid()
  AND (
    -- Must be a member of the club
    is_club_member(auth.uid(), club_id)
    -- OR must be a member of the team (if team_id is provided)
    OR (team_id IS NOT NULL AND is_team_member(auth.uid(), team_id))
  )
);