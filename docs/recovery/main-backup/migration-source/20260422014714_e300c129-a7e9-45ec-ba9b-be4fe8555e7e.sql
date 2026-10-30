-- Add chat-group-aware columns to vault_folders so role-restricted chats
-- (Coaches Chat, Team Admins Chat, Committee Chat, Club Admin Chat, etc.)
-- can have their own dedicated subfolder under the club vault.

ALTER TABLE public.vault_folders
  ADD COLUMN IF NOT EXISTS chat_group_id uuid REFERENCES public.chat_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS restricted_roles public.app_role[] NULL;

CREATE INDEX IF NOT EXISTS idx_vault_folders_chat_group_id
  ON public.vault_folders(chat_group_id)
  WHERE chat_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vault_folders_restricted_roles
  ON public.vault_folders USING GIN (restricted_roles)
  WHERE restricted_roles IS NOT NULL;

-- Helper: does the user have ANY of the given roles in the given club?
CREATE OR REPLACE FUNCTION public.user_has_any_club_role(
  _user_id uuid,
  _club_id uuid,
  _roles public.app_role[]
)
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
      AND ur.club_id = _club_id
      AND ur.role = ANY(_roles)
  )
  OR EXISTS (
    -- App admins can see everything
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role = 'app_admin'
  );
$$;