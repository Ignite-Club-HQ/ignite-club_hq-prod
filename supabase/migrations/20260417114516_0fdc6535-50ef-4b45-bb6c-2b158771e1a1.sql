-- Allow any member of a personal (non-team, non-club) group chat to add new members.
-- The existing "Group creators can manage members" policy still grants full ALL access to creators.
-- This adds an additional INSERT path so any current member can also invite people, while
-- only creators retain the ability to delete (remove) members and update the chat.

CREATE POLICY "Members can add people to personal groups"
ON public.group_members
FOR INSERT
TO authenticated
WITH CHECK (
  -- Only applies to personal groups (no team/club/league binding)
  EXISTS (
    SELECT 1
    FROM public.chat_groups cg
    WHERE cg.id = group_members.group_id
      AND cg.team_id IS NULL
      AND cg.club_id IS NULL
      AND cg.mini_league_id IS NULL
  )
  -- The current user must already be a member of the group
  AND EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = group_members.group_id
      AND gm.user_id = auth.uid()
  )
  -- Track who performed the add
  AND added_by = auth.uid()
);
