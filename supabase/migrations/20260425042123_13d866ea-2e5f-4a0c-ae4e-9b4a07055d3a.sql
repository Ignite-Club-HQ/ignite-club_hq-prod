-- =============================================================
-- 1. Helper: check if the current user matches a folder's role restriction
-- =============================================================
CREATE OR REPLACE FUNCTION public.user_matches_folder_role(
  _user_id uuid,
  _club_id uuid,
  _team_id uuid,
  _restricted_roles app_role[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- No restriction → anyone with normal vault access already passed earlier policy
    _restricted_roles IS NULL
    OR array_length(_restricted_roles, 1) IS NULL
    OR EXISTS (
      SELECT 1
      FROM user_roles ur
      WHERE ur.user_id = _user_id
        AND ur.role = ANY (_restricted_roles)
        AND (
          -- Team-scoped folder: role must be on this team
          (_team_id IS NOT NULL AND ur.team_id = _team_id)
          OR
          -- Club-scoped folder: role must be in this club (any team or club-level)
          (_team_id IS NULL AND (
            ur.club_id = _club_id
            OR ur.team_id IN (SELECT t.id FROM teams t WHERE t.club_id = _club_id)
          ))
        )
    );
$$;

-- =============================================================
-- 2. Update vault_folders RLS to honour restricted_roles
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
);

-- =============================================================
-- 3. Update vault_files RLS to honour folder restricted_roles
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
    )
  )
);

-- =============================================================
-- 4. Seed role folders for a club (idempotent)
-- =============================================================
CREATE OR REPLACE FUNCTION public.ensure_club_role_folders(_club_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Coaches
  INSERT INTO vault_folders (club_id, team_id, parent_id, name, restricted_roles)
  SELECT _club_id, NULL, NULL, 'Coaches', ARRAY['coach'::app_role]
  WHERE NOT EXISTS (
    SELECT 1 FROM vault_folders
    WHERE club_id = _club_id AND team_id IS NULL AND parent_id IS NULL
      AND name = 'Coaches' AND restricted_roles = ARRAY['coach'::app_role]
  );
  -- Team Admins
  INSERT INTO vault_folders (club_id, team_id, parent_id, name, restricted_roles)
  SELECT _club_id, NULL, NULL, 'Team Admins', ARRAY['team_admin'::app_role]
  WHERE NOT EXISTS (
    SELECT 1 FROM vault_folders
    WHERE club_id = _club_id AND team_id IS NULL AND parent_id IS NULL
      AND name = 'Team Admins' AND restricted_roles = ARRAY['team_admin'::app_role]
  );
  -- Team Admins & Coaches
  INSERT INTO vault_folders (club_id, team_id, parent_id, name, restricted_roles)
  SELECT _club_id, NULL, NULL, 'Team Admins & Coaches', ARRAY['team_admin'::app_role,'coach'::app_role]
  WHERE NOT EXISTS (
    SELECT 1 FROM vault_folders
    WHERE club_id = _club_id AND team_id IS NULL AND parent_id IS NULL
      AND name = 'Team Admins & Coaches'
      AND restricted_roles = ARRAY['team_admin'::app_role,'coach'::app_role]
  );
END;
$$;

-- =============================================================
-- 5. Seed role folders for a team (idempotent)
-- =============================================================
CREATE OR REPLACE FUNCTION public.ensure_team_role_folders(_team_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _club_id uuid;
BEGIN
  SELECT club_id INTO _club_id FROM teams WHERE id = _team_id;
  IF _club_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO vault_folders (club_id, team_id, parent_id, name, restricted_roles)
  SELECT _club_id, _team_id, NULL, 'Coaches', ARRAY['coach'::app_role]
  WHERE NOT EXISTS (
    SELECT 1 FROM vault_folders
    WHERE team_id = _team_id AND parent_id IS NULL
      AND name = 'Coaches' AND restricted_roles = ARRAY['coach'::app_role]
  );

  INSERT INTO vault_folders (club_id, team_id, parent_id, name, restricted_roles)
  SELECT _club_id, _team_id, NULL, 'Team Admins', ARRAY['team_admin'::app_role]
  WHERE NOT EXISTS (
    SELECT 1 FROM vault_folders
    WHERE team_id = _team_id AND parent_id IS NULL
      AND name = 'Team Admins' AND restricted_roles = ARRAY['team_admin'::app_role]
  );

  INSERT INTO vault_folders (club_id, team_id, parent_id, name, restricted_roles)
  SELECT _club_id, _team_id, NULL, 'Team Admins & Coaches', ARRAY['team_admin'::app_role,'coach'::app_role]
  WHERE NOT EXISTS (
    SELECT 1 FROM vault_folders
    WHERE team_id = _team_id AND parent_id IS NULL
      AND name = 'Team Admins & Coaches'
      AND restricted_roles = ARRAY['team_admin'::app_role,'coach'::app_role]
  );
END;
$$;

-- =============================================================
-- 6. Triggers: auto-seed on club / team creation
-- =============================================================
CREATE OR REPLACE FUNCTION public.trg_seed_club_role_folders()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ensure_club_role_folders(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_seed_team_role_folders()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ensure_team_role_folders(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_club_role_folders_trg ON public.clubs;
CREATE TRIGGER seed_club_role_folders_trg
AFTER INSERT ON public.clubs
FOR EACH ROW EXECUTE FUNCTION public.trg_seed_club_role_folders();

DROP TRIGGER IF EXISTS seed_team_role_folders_trg ON public.teams;
CREATE TRIGGER seed_team_role_folders_trg
AFTER INSERT ON public.teams
FOR EACH ROW EXECUTE FUNCTION public.trg_seed_team_role_folders();

-- =============================================================
-- 7. Protect role folders from rename / delete
-- =============================================================
CREATE OR REPLACE FUNCTION public.protect_role_folders()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.restricted_roles IS NOT NULL AND array_length(OLD.restricted_roles, 1) > 0
       AND OLD.parent_id IS NULL
       AND OLD.name IN ('Coaches','Team Admins','Team Admins & Coaches') THEN
      RAISE EXCEPTION 'Role-restricted vault folders cannot be deleted';
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.restricted_roles IS NOT NULL AND array_length(OLD.restricted_roles, 1) > 0
       AND OLD.parent_id IS NULL
       AND OLD.name IN ('Coaches','Team Admins','Team Admins & Coaches')
       AND NEW.name <> OLD.name THEN
      RAISE EXCEPTION 'Role-restricted vault folders cannot be renamed';
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_role_folders_trg ON public.vault_folders;
CREATE TRIGGER protect_role_folders_trg
BEFORE UPDATE OR DELETE ON public.vault_folders
FOR EACH ROW EXECUTE FUNCTION public.protect_role_folders();

-- =============================================================
-- 8. Backfill: seed for all existing clubs and teams
-- =============================================================
DO $$
DECLARE
  c RECORD;
  t RECORD;
BEGIN
  FOR c IN SELECT id FROM clubs LOOP
    PERFORM public.ensure_club_role_folders(c.id);
  END LOOP;
  FOR t IN SELECT id FROM teams LOOP
    PERFORM public.ensure_team_role_folders(t.id);
  END LOOP;
END $$;