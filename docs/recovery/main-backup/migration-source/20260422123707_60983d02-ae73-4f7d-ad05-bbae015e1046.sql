CREATE OR REPLACE FUNCTION public.is_group_member(_group_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.group_members
    WHERE group_id = _group_id
      AND user_id = _user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_group_member(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Members can view group members" ON public.group_members;
CREATE POLICY "Members can view group members"
ON public.group_members
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_group_member(group_id, auth.uid())
);

DROP POLICY IF EXISTS "Members can add people to personal groups" ON public.group_members;
CREATE POLICY "Members can add people to personal groups"
ON public.group_members
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.chat_groups cg
    WHERE cg.id = group_members.group_id
      AND cg.team_id IS NULL
      AND cg.club_id IS NULL
      AND cg.mini_league_id IS NULL
  )
  AND public.is_group_member(group_id, auth.uid())
  AND added_by = auth.uid()
);