CREATE POLICY "Members can add to open club groups"
ON public.group_members
FOR INSERT
WITH CHECK (
  added_by = auth.uid()
  AND is_group_member(group_id, auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.chat_groups cg
    WHERE cg.id = group_members.group_id
      AND cg.club_id IS NOT NULL
      AND cg.team_id IS NULL
      AND cg.mini_league_id IS NULL
      AND cg.join_policy = 'open_to_club'
      AND cg.category IN ('Operations', 'Volunteers')
      AND EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = group_members.user_id
          AND ur.club_id = cg.club_id
      )
  )
);