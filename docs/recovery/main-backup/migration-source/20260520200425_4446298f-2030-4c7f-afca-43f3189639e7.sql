
-- Allow club admins to view deleted chat groups in their club
CREATE POLICY "Club admins can view deleted club chat groups"
ON public.chat_groups
FOR SELECT
USING (
  deleted_at IS NOT NULL
  AND club_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
      AND user_roles.club_id = chat_groups.club_id
      AND user_roles.role = 'club_admin'::app_role
  )
);

-- Allow club admins to restore (update) deleted chat groups in their club
CREATE POLICY "Club admins can restore deleted club chat groups"
ON public.chat_groups
FOR UPDATE
USING (
  club_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
      AND user_roles.club_id = chat_groups.club_id
      AND user_roles.role = 'club_admin'::app_role
  )
)
WITH CHECK (
  club_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
      AND user_roles.club_id = chat_groups.club_id
      AND user_roles.role = 'club_admin'::app_role
  )
);
