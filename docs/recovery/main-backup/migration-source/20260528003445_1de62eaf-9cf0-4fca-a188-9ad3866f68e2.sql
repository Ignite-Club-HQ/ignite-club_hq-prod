
-- =============================================================
-- Lock down chat-group-linked vault folders to actual group members
-- =============================================================
-- Folders with chat_group_id set (BBQ/Canteen, Grounds, etc.)
-- now require: admin bypass OR can_access_chat_group(uid, chat_group_id).
-- Role-based restricted_roles gating remains layered on top.
-- =============================================================

DROP POLICY IF EXISTS "Club members can view club vault folders" ON public.vault_folders;
DROP POLICY IF EXISTS "Team members can view team vault folders" ON public.vault_folders;
DROP POLICY IF EXISTS "Team admins and coaches can manage team vault folders" ON public.vault_folders;

CREATE POLICY "Club members can view club vault folders"
ON public.vault_folders
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        ur.club_id = vault_folders.club_id
        OR ur.club_id IN (SELECT t.club_id FROM teams t WHERE t.id = vault_folders.team_id)
      )
  )
  AND (
    restricted_roles IS NULL
    OR array_length(restricted_roles, 1) IS NULL
    OR public.has_role(auth.uid(), 'app_admin')
    OR public.has_role(auth.uid(), 'club_admin')
    OR public.has_role(auth.uid(), 'committee_member')
    OR public.user_matches_folder_role(auth.uid(), club_id, team_id, restricted_roles)
  )
  AND (
    chat_group_id IS NULL
    OR public.has_role(auth.uid(), 'app_admin')
    OR public.has_role(auth.uid(), 'club_admin')
    OR public.has_role(auth.uid(), 'committee_member')
    OR public.can_access_chat_group(auth.uid(), chat_group_id)
  )
);

CREATE POLICY "Team members can view team vault folders"
ON public.vault_folders
FOR SELECT
USING (
  team_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.team_id = vault_folders.team_id
  )
  AND (
    restricted_roles IS NULL
    OR array_length(restricted_roles, 1) IS NULL
    OR public.has_role(auth.uid(), 'app_admin')
    OR public.has_role(auth.uid(), 'club_admin')
    OR public.has_role(auth.uid(), 'committee_member')
    OR public.user_matches_folder_role(auth.uid(), club_id, team_id, restricted_roles)
  )
  AND (
    chat_group_id IS NULL
    OR public.has_role(auth.uid(), 'app_admin')
    OR public.has_role(auth.uid(), 'club_admin')
    OR public.has_role(auth.uid(), 'committee_member')
    OR public.can_access_chat_group(auth.uid(), chat_group_id)
  )
);

CREATE POLICY "Team admins and coaches can manage team vault folders"
ON public.vault_folders
FOR ALL
USING (
  team_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.team_id = vault_folders.team_id
      AND ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role])
  )
  AND (
    restricted_roles IS NULL
    OR array_length(restricted_roles, 1) IS NULL
    OR public.user_matches_folder_role(auth.uid(), club_id, team_id, restricted_roles)
  )
  AND (
    chat_group_id IS NULL
    OR public.can_access_chat_group(auth.uid(), chat_group_id)
  )
)
WITH CHECK (
  team_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.team_id = vault_folders.team_id
      AND ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role])
  )
  AND (
    restricted_roles IS NULL
    OR array_length(restricted_roles, 1) IS NULL
    OR public.user_matches_folder_role(auth.uid(), club_id, team_id, restricted_roles)
  )
  AND (
    chat_group_id IS NULL
    OR public.can_access_chat_group(auth.uid(), chat_group_id)
  )
);

-- =============================================================
-- vault_files: mirror the chat-group gate via parent folder
-- =============================================================
DROP POLICY IF EXISTS "Club members can view club vault files" ON public.vault_files;
DROP POLICY IF EXISTS "Team members can view team vault files" ON public.vault_files;
DROP POLICY IF EXISTS "Team admins and coaches can manage team vault files" ON public.vault_files;

CREATE POLICY "Club members can view club vault files"
ON public.vault_files
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        ur.club_id = vault_files.club_id
        OR ur.club_id IN (SELECT t.club_id FROM teams t WHERE t.id = vault_files.team_id)
      )
  )
  AND (
    vault_files.folder_id IS NULL
    OR public.has_role(auth.uid(), 'app_admin')
    OR public.has_role(auth.uid(), 'club_admin')
    OR public.has_role(auth.uid(), 'committee_member')
    OR EXISTS (
      SELECT 1 FROM vault_folders vf
      WHERE vf.id = vault_files.folder_id
        AND (
          vf.restricted_roles IS NULL
          OR array_length(vf.restricted_roles, 1) IS NULL
          OR public.user_matches_folder_role(auth.uid(), vf.club_id, vf.team_id, vf.restricted_roles)
        )
        AND (
          vf.chat_group_id IS NULL
          OR public.can_access_chat_group(auth.uid(), vf.chat_group_id)
        )
    )
  )
);

CREATE POLICY "Team members can view team vault files"
ON public.vault_files
FOR SELECT
USING (
  team_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.team_id = vault_files.team_id
  )
  AND (
    vault_files.folder_id IS NULL
    OR public.has_role(auth.uid(), 'app_admin')
    OR public.has_role(auth.uid(), 'club_admin')
    OR public.has_role(auth.uid(), 'committee_member')
    OR EXISTS (
      SELECT 1 FROM vault_folders vf
      WHERE vf.id = vault_files.folder_id
        AND (
          vf.restricted_roles IS NULL
          OR array_length(vf.restricted_roles, 1) IS NULL
          OR public.user_matches_folder_role(auth.uid(), vf.club_id, vf.team_id, vf.restricted_roles)
        )
        AND (
          vf.chat_group_id IS NULL
          OR public.can_access_chat_group(auth.uid(), vf.chat_group_id)
        )
    )
  )
);

CREATE POLICY "Team admins and coaches can manage team vault files"
ON public.vault_files
FOR ALL
USING (
  (
    (team_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.team_id = vault_files.team_id
        AND ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role])
    ))
    OR
    (folder_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM vault_folders vf
      JOIN user_roles ur ON ur.team_id = vf.team_id
      WHERE vf.id = vault_files.folder_id
        AND ur.user_id = auth.uid()
        AND ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role])
    ))
  )
  AND (
    vault_files.folder_id IS NULL
    OR EXISTS (
      SELECT 1 FROM vault_folders vf
      WHERE vf.id = vault_files.folder_id
        AND (
          vf.restricted_roles IS NULL
          OR array_length(vf.restricted_roles, 1) IS NULL
          OR public.user_matches_folder_role(auth.uid(), vf.club_id, vf.team_id, vf.restricted_roles)
        )
        AND (
          vf.chat_group_id IS NULL
          OR public.can_access_chat_group(auth.uid(), vf.chat_group_id)
        )
    )
  )
)
WITH CHECK (
  (
    (team_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.team_id = vault_files.team_id
        AND ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role])
    ))
    OR
    (folder_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM vault_folders vf
      JOIN user_roles ur ON ur.team_id = vf.team_id
      WHERE vf.id = vault_files.folder_id
        AND ur.user_id = auth.uid()
        AND ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role])
    ))
  )
  AND (
    vault_files.folder_id IS NULL
    OR EXISTS (
      SELECT 1 FROM vault_folders vf
      WHERE vf.id = vault_files.folder_id
        AND (
          vf.restricted_roles IS NULL
          OR array_length(vf.restricted_roles, 1) IS NULL
          OR public.user_matches_folder_role(auth.uid(), vf.club_id, vf.team_id, vf.restricted_roles)
        )
        AND (
          vf.chat_group_id IS NULL
          OR public.can_access_chat_group(auth.uid(), vf.chat_group_id)
        )
    )
  )
);
