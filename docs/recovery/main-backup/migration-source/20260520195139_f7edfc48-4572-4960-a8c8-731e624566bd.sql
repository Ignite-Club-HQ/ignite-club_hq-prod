
ALTER TABLE public.chat_groups
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

CREATE INDEX IF NOT EXISTS chat_groups_deleted_at_idx ON public.chat_groups(deleted_at);

-- Replace SELECT policies to exclude deleted rows for non-admins.
DROP POLICY IF EXISTS "Users can view accessible groups" ON public.chat_groups;
DROP POLICY IF EXISTS "Users can access mini league chats" ON public.chat_groups;

CREATE POLICY "Users can view accessible groups"
ON public.chat_groups
FOR SELECT
USING (
  deleted_at IS NULL
  AND (created_by = auth.uid() OR public.can_access_chat_group(auth.uid(), id))
);

CREATE POLICY "Users can access mini league chats"
ON public.chat_groups
FOR SELECT
USING (
  deleted_at IS NULL
  AND mini_league_id IS NOT NULL
  AND public.can_access_chat_group(auth.uid(), id)
);

-- App admins can view, update (restore), and delete any group, including deleted ones.
CREATE POLICY "App admins can view all chat groups"
ON public.chat_groups
FOR SELECT
USING (public.has_role(auth.uid(), 'app_admin'));

CREATE POLICY "App admins can manage all chat groups"
ON public.chat_groups
FOR UPDATE
USING (public.has_role(auth.uid(), 'app_admin'))
WITH CHECK (public.has_role(auth.uid(), 'app_admin'));

CREATE POLICY "App admins can delete any chat group"
ON public.chat_groups
FOR DELETE
USING (public.has_role(auth.uid(), 'app_admin'));
