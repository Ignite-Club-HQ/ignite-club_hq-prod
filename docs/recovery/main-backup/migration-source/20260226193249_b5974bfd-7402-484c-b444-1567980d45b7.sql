
-- Allow users to view profiles of anyone who posted in a club chat they belong to
CREATE POLICY "Users can view profiles of club chat message authors"
ON public.profiles
FOR SELECT
USING (
  id IN (
    SELECT DISTINCT cm.author_id
    FROM club_messages cm
    WHERE cm.club_id IN (
      SELECT ur.club_id FROM user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.club_id IS NOT NULL
    )
  )
);
