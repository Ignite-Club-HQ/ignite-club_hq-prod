CREATE OR REPLACE FUNCTION public.club_admin_can_rename_group(_user_id uuid, _group_id uuid, _club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role = 'club_admin'
      AND ur.club_id IS NOT NULL
      AND (
        (_club_id IS NOT NULL AND ur.club_id = _club_id)
        OR EXISTS (
          SELECT 1
          FROM public.group_members gm
          JOIN public.user_roles mr
            ON mr.user_id = gm.user_id
           AND mr.club_id = ur.club_id
          WHERE gm.group_id = _group_id
        )
      )
  )
$$;

GRANT EXECUTE ON FUNCTION public.club_admin_can_rename_group(uuid, uuid, uuid) TO authenticated;

CREATE POLICY "Club admins can rename club-member groups"
ON public.chat_groups
FOR UPDATE
TO authenticated
USING (public.club_admin_can_rename_group((SELECT auth.uid()), id, club_id))
WITH CHECK (public.club_admin_can_rename_group((SELECT auth.uid()), id, club_id));