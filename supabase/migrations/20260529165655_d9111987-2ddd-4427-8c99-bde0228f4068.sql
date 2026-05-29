-- Helper: single STABLE SECURITY DEFINER admin check used by vault SELECT policies.
CREATE OR REPLACE FUNCTION public.is_vault_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('app_admin'::app_role, 'club_admin'::app_role, 'committee_member'::app_role)
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_vault_admin(uuid) TO authenticated, anon, service_role;

-- ============================================================
-- vault_folders: collapse 2 SELECT policies into 1
-- ============================================================
DROP POLICY IF EXISTS "Club members can view club vault folders" ON public.vault_folders;
DROP POLICY IF EXISTS "Team members can view team vault folders" ON public.vault_folders;

CREATE POLICY "Members can view vault folders"
ON public.vault_folders
FOR SELECT
USING (
  (
    vault_user_has_club_scope((SELECT auth.uid()), club_id, team_id)
    OR (team_id IS NOT NULL AND vault_user_has_team_scope((SELECT auth.uid()), team_id))
  )
  AND (
    restricted_roles IS NULL
    OR array_length(restricted_roles, 1) IS NULL
    OR is_vault_admin((SELECT auth.uid()))
    OR user_matches_folder_role((SELECT auth.uid()), club_id, team_id, restricted_roles)
  )
  AND (
    chat_group_id IS NULL
    OR is_vault_admin((SELECT auth.uid()))
    OR can_access_chat_group((SELECT auth.uid()), chat_group_id)
  )
);

-- ============================================================
-- vault_files: collapse 2 SELECT policies into 1
-- ============================================================
DROP POLICY IF EXISTS "Club members can view club vault files" ON public.vault_files;
DROP POLICY IF EXISTS "Team members can view team vault files" ON public.vault_files;

CREATE POLICY "Members can view vault files"
ON public.vault_files
FOR SELECT
USING (
  (
    vault_user_has_club_scope((SELECT auth.uid()), club_id, team_id)
    OR (team_id IS NOT NULL AND vault_user_has_team_scope((SELECT auth.uid()), team_id))
  )
  AND (
    folder_id IS NULL
    OR is_vault_admin((SELECT auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.vault_folders vf
      WHERE vf.id = vault_files.folder_id
        AND (
          vf.restricted_roles IS NULL
          OR array_length(vf.restricted_roles, 1) IS NULL
          OR user_matches_folder_role((SELECT auth.uid()), vf.club_id, vf.team_id, vf.restricted_roles)
        )
        AND (
          vf.chat_group_id IS NULL
          OR can_access_chat_group((SELECT auth.uid()), vf.chat_group_id)
        )
    )
  )
);