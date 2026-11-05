-- Vault RLS performance fix: avoid RLS-chained user_roles scans from vault_folders/vault_files.
-- The helpers are SECURITY DEFINER so role lookups use indexed tables directly and do not
-- recursively invoke user_roles RLS for every candidate vault row.

BEGIN;

CREATE OR REPLACE FUNCTION public.vault_user_has_club_scope(
  _user_id uuid,
  _club_id uuid,
  _team_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND (
        ur.club_id = _club_id
        OR (
          _team_id IS NOT NULL
          AND ur.club_id IN (
            SELECT t.club_id FROM public.teams t WHERE t.id = _team_id
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.vault_user_has_club_role_scope(
  _user_id uuid,
  _club_id uuid,
  _team_id uuid,
  _roles public.app_role[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role = ANY (_roles)
      AND (
        ur.club_id = _club_id
        OR (
          _team_id IS NOT NULL
          AND ur.club_id IN (
            SELECT t.club_id FROM public.teams t WHERE t.id = _team_id
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.vault_user_has_team_scope(
  _user_id uuid,
  _team_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.team_id = _team_id
  );
$$;

CREATE OR REPLACE FUNCTION public.vault_user_has_team_role_scope(
  _user_id uuid,
  _team_id uuid,
  _roles public.app_role[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.team_id = _team_id
      AND ur.role = ANY (_roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.vault_user_has_file_club_role_scope(
  _user_id uuid,
  _club_id uuid,
  _team_id uuid,
  _folder_id uuid,
  _roles public.app_role[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role = ANY (_roles)
      AND (
        ur.club_id = _club_id
        OR (
          _team_id IS NOT NULL
          AND ur.club_id IN (
            SELECT t.club_id FROM public.teams t WHERE t.id = _team_id
          )
        )
        OR (
          _folder_id IS NOT NULL
          AND ur.club_id IN (
            SELECT COALESCE(vf.club_id, t.club_id)
            FROM public.vault_folders vf
            LEFT JOIN public.teams t ON t.id = vf.team_id
            WHERE vf.id = _folder_id
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.vault_user_has_file_team_role_scope(
  _user_id uuid,
  _team_id uuid,
  _folder_id uuid,
  _roles public.app_role[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role = ANY (_roles)
      AND (
        (_team_id IS NOT NULL AND ur.team_id = _team_id)
        OR (
          _folder_id IS NOT NULL
          AND ur.team_id IN (
            SELECT vf.team_id
            FROM public.vault_folders vf
            WHERE vf.id = _folder_id
              AND vf.team_id IS NOT NULL
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.vault_user_has_mini_league_role_scope(
  _user_id uuid,
  _mini_league_id uuid,
  _roles public.app_role[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.mini_leagues ml ON ml.club_id = ur.club_id
    WHERE ml.id = _mini_league_id
      AND ur.user_id = _user_id
      AND ur.role = ANY (_roles)
  );
$$;

-- Help active vault listings avoid scanning the large soft-deleted folder set.
CREATE INDEX IF NOT EXISTS idx_vault_folders_team_parent_name_active
ON public.vault_folders (team_id, parent_id, name)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vault_folders_parent_name_active
ON public.vault_folders (parent_id, name)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vault_files_team_folder_active
ON public.vault_files (team_id, folder_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vault_files_mini_league_folder_active
ON public.vault_files (mini_league_id, folder_id, created_at DESC)
WHERE deleted_at IS NULL;

DROP POLICY IF EXISTS "Club admins and committee can manage club vault folders" ON public.vault_folders;
CREATE POLICY "Club admins and committee can manage club vault folders"
ON public.vault_folders
AS PERMISSIVE
FOR ALL
TO public
USING (
  public.vault_user_has_club_role_scope(
    (SELECT auth.uid()),
    vault_folders.club_id,
    vault_folders.team_id,
    ARRAY['club_admin'::app_role, 'committee_member'::app_role, 'app_admin'::app_role]
  )
)
WITH CHECK (
  public.vault_user_has_club_role_scope(
    (SELECT auth.uid()),
    vault_folders.club_id,
    vault_folders.team_id,
    ARRAY['club_admin'::app_role, 'committee_member'::app_role, 'app_admin'::app_role]
  )
);

DROP POLICY IF EXISTS "Club members can view club vault folders" ON public.vault_folders;
CREATE POLICY "Club members can view club vault folders"
ON public.vault_folders
AS PERMISSIVE
FOR SELECT
TO public
USING (
  public.vault_user_has_club_scope((SELECT auth.uid()), vault_folders.club_id, vault_folders.team_id)
  AND (
    restricted_roles IS NULL
    OR array_length(restricted_roles, 1) IS NULL
    OR public.has_role((SELECT auth.uid()), 'app_admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'club_admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'committee_member'::app_role)
    OR public.user_matches_folder_role((SELECT auth.uid()), club_id, team_id, restricted_roles)
  )
  AND (
    chat_group_id IS NULL
    OR public.has_role((SELECT auth.uid()), 'app_admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'club_admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'committee_member'::app_role)
    OR public.can_access_chat_group((SELECT auth.uid()), chat_group_id)
  )
);

DROP POLICY IF EXISTS "Team admins and coaches can manage team vault folders" ON public.vault_folders;
CREATE POLICY "Team admins and coaches can manage team vault folders"
ON public.vault_folders
AS PERMISSIVE
FOR ALL
TO public
USING (
  team_id IS NOT NULL
  AND public.vault_user_has_team_role_scope((SELECT auth.uid()), vault_folders.team_id, ARRAY['team_admin'::app_role, 'coach'::app_role])
  AND (
    restricted_roles IS NULL
    OR array_length(restricted_roles, 1) IS NULL
    OR public.user_matches_folder_role((SELECT auth.uid()), club_id, team_id, restricted_roles)
  )
  AND (
    chat_group_id IS NULL
    OR public.can_access_chat_group((SELECT auth.uid()), chat_group_id)
  )
)
WITH CHECK (
  team_id IS NOT NULL
  AND public.vault_user_has_team_role_scope((SELECT auth.uid()), vault_folders.team_id, ARRAY['team_admin'::app_role, 'coach'::app_role])
  AND (
    restricted_roles IS NULL
    OR array_length(restricted_roles, 1) IS NULL
    OR public.user_matches_folder_role((SELECT auth.uid()), club_id, team_id, restricted_roles)
  )
  AND (
    chat_group_id IS NULL
    OR public.can_access_chat_group((SELECT auth.uid()), chat_group_id)
  )
);

DROP POLICY IF EXISTS "Team members can view team vault folders" ON public.vault_folders;
CREATE POLICY "Team members can view team vault folders"
ON public.vault_folders
AS PERMISSIVE
FOR SELECT
TO public
USING (
  team_id IS NOT NULL
  AND public.vault_user_has_team_scope((SELECT auth.uid()), vault_folders.team_id)
  AND (
    restricted_roles IS NULL
    OR array_length(restricted_roles, 1) IS NULL
    OR public.has_role((SELECT auth.uid()), 'app_admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'club_admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'committee_member'::app_role)
    OR public.user_matches_folder_role((SELECT auth.uid()), club_id, team_id, restricted_roles)
  )
  AND (
    chat_group_id IS NULL
    OR public.has_role((SELECT auth.uid()), 'app_admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'club_admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'committee_member'::app_role)
    OR public.can_access_chat_group((SELECT auth.uid()), chat_group_id)
  )
);

DROP POLICY IF EXISTS "Club admins and committee can manage club vault files" ON public.vault_files;
CREATE POLICY "Club admins and committee can manage club vault files"
ON public.vault_files
AS PERMISSIVE
FOR ALL
TO public
USING (
  public.vault_user_has_file_club_role_scope(
    (SELECT auth.uid()),
    vault_files.club_id,
    vault_files.team_id,
    vault_files.folder_id,
    ARRAY['club_admin'::app_role, 'committee_member'::app_role, 'app_admin'::app_role]
  )
)
WITH CHECK (
  public.vault_user_has_file_club_role_scope(
    (SELECT auth.uid()),
    vault_files.club_id,
    vault_files.team_id,
    vault_files.folder_id,
    ARRAY['club_admin'::app_role, 'committee_member'::app_role, 'app_admin'::app_role]
  )
);

DROP POLICY IF EXISTS "Club members can view club vault files" ON public.vault_files;
CREATE POLICY "Club members can view club vault files"
ON public.vault_files
AS PERMISSIVE
FOR SELECT
TO public
USING (
  public.vault_user_has_club_scope((SELECT auth.uid()), vault_files.club_id, vault_files.team_id)
  AND (
    folder_id IS NULL
    OR public.has_role((SELECT auth.uid()), 'app_admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'club_admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'committee_member'::app_role)
    OR EXISTS (
      SELECT 1
      FROM public.vault_folders vf
      WHERE vf.id = vault_files.folder_id
        AND (
          vf.restricted_roles IS NULL
          OR array_length(vf.restricted_roles, 1) IS NULL
          OR public.user_matches_folder_role((SELECT auth.uid()), vf.club_id, vf.team_id, vf.restricted_roles)
        )
        AND (
          vf.chat_group_id IS NULL
          OR public.can_access_chat_group((SELECT auth.uid()), vf.chat_group_id)
        )
    )
  )
);

DROP POLICY IF EXISTS "League admins can manage mini league vault files" ON public.vault_files;
CREATE POLICY "League admins can manage mini league vault files"
ON public.vault_files
AS PERMISSIVE
FOR ALL
TO public
USING (
  mini_league_id IS NOT NULL
  AND public.vault_user_has_mini_league_role_scope(
    (SELECT auth.uid()),
    vault_files.mini_league_id,
    ARRAY['league_admin'::app_role, 'club_admin'::app_role, 'app_admin'::app_role]
  )
)
WITH CHECK (
  mini_league_id IS NOT NULL
  AND public.vault_user_has_mini_league_role_scope(
    (SELECT auth.uid()),
    vault_files.mini_league_id,
    ARRAY['league_admin'::app_role, 'club_admin'::app_role, 'app_admin'::app_role]
  )
);

DROP POLICY IF EXISTS "Team admins and coaches can manage team vault files" ON public.vault_files;
CREATE POLICY "Team admins and coaches can manage team vault files"
ON public.vault_files
AS PERMISSIVE
FOR ALL
TO public
USING (
  public.vault_user_has_file_team_role_scope(
    (SELECT auth.uid()),
    vault_files.team_id,
    vault_files.folder_id,
    ARRAY['team_admin'::app_role, 'coach'::app_role]
  )
  AND (
    folder_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.vault_folders vf
      WHERE vf.id = vault_files.folder_id
        AND (
          vf.restricted_roles IS NULL
          OR array_length(vf.restricted_roles, 1) IS NULL
          OR public.user_matches_folder_role((SELECT auth.uid()), vf.club_id, vf.team_id, vf.restricted_roles)
        )
        AND (
          vf.chat_group_id IS NULL
          OR public.can_access_chat_group((SELECT auth.uid()), vf.chat_group_id)
        )
    )
  )
)
WITH CHECK (
  public.vault_user_has_file_team_role_scope(
    (SELECT auth.uid()),
    vault_files.team_id,
    vault_files.folder_id,
    ARRAY['team_admin'::app_role, 'coach'::app_role]
  )
  AND (
    folder_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.vault_folders vf
      WHERE vf.id = vault_files.folder_id
        AND (
          vf.restricted_roles IS NULL
          OR array_length(vf.restricted_roles, 1) IS NULL
          OR public.user_matches_folder_role((SELECT auth.uid()), vf.club_id, vf.team_id, vf.restricted_roles)
        )
        AND (
          vf.chat_group_id IS NULL
          OR public.can_access_chat_group((SELECT auth.uid()), vf.chat_group_id)
        )
    )
  )
);

DROP POLICY IF EXISTS "Team members can view team vault files" ON public.vault_files;
CREATE POLICY "Team members can view team vault files"
ON public.vault_files
AS PERMISSIVE
FOR SELECT
TO public
USING (
  team_id IS NOT NULL
  AND public.vault_user_has_team_scope((SELECT auth.uid()), vault_files.team_id)
  AND (
    folder_id IS NULL
    OR public.has_role((SELECT auth.uid()), 'app_admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'club_admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'committee_member'::app_role)
    OR EXISTS (
      SELECT 1
      FROM public.vault_folders vf
      WHERE vf.id = vault_files.folder_id
        AND (
          vf.restricted_roles IS NULL
          OR array_length(vf.restricted_roles, 1) IS NULL
          OR public.user_matches_folder_role((SELECT auth.uid()), vf.club_id, vf.team_id, vf.restricted_roles)
        )
        AND (
          vf.chat_group_id IS NULL
          OR public.can_access_chat_group((SELECT auth.uid()), vf.chat_group_id)
        )
    )
  )
);

COMMIT;