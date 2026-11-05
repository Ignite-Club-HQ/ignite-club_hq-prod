-- Allow users to remove themselves from personal group chats (leave group)
-- Only applies to personal groups (no team_id, club_id, or mini_league_id)
CREATE POLICY "Users can leave personal groups"
ON public.group_members
FOR DELETE
TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.chat_groups cg
    WHERE cg.id = group_members.group_id
      AND cg.team_id IS NULL
      AND cg.club_id IS NULL
      AND cg.mini_league_id IS NULL
  )
);