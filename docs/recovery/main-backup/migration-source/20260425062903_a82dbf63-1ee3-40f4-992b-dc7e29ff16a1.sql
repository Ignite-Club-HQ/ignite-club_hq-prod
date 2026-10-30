
-- Temporarily disable the protection trigger so we can clean up the duplicate.
ALTER TABLE public.vault_folders DISABLE TRIGGER protect_role_folders_trg;

-- Drop the empty duplicate folder. The remaining folder
-- (id = 0fd9d81c-44ac-4735-baaf-e0d24d885ecf) has 5 files and a broader role
-- set ({league_admin,team_admin,coach}) and is the one users should keep using.
DELETE FROM public.vault_folders
WHERE id = '005baf36-ab97-4939-a4c2-8722ad458a76';

-- Re-enable the protection trigger.
ALTER TABLE public.vault_folders ENABLE TRIGGER protect_role_folders_trg;

-- Harden ensure_club_role_folders: only create a folder if no existing folder
-- already covers the requested role set (superset match using @>).
CREATE OR REPLACE FUNCTION public.ensure_club_role_folders(_club_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO vault_folders (club_id, team_id, parent_id, name, restricted_roles)
  SELECT _club_id, NULL, NULL, 'Coaches', ARRAY['coach'::app_role]
  WHERE NOT EXISTS (
    SELECT 1 FROM vault_folders
    WHERE club_id = _club_id AND team_id IS NULL AND parent_id IS NULL
      AND name = 'Coaches'
      AND restricted_roles @> ARRAY['coach'::app_role]
  );

  INSERT INTO vault_folders (club_id, team_id, parent_id, name, restricted_roles)
  SELECT _club_id, NULL, NULL, 'Team Admins', ARRAY['team_admin'::app_role]
  WHERE NOT EXISTS (
    SELECT 1 FROM vault_folders
    WHERE club_id = _club_id AND team_id IS NULL AND parent_id IS NULL
      AND name = 'Team Admins'
      AND restricted_roles @> ARRAY['team_admin'::app_role]
  );

  INSERT INTO vault_folders (club_id, team_id, parent_id, name, restricted_roles)
  SELECT _club_id, NULL, NULL, 'Team Admins & Coaches', ARRAY['team_admin'::app_role,'coach'::app_role]
  WHERE NOT EXISTS (
    SELECT 1 FROM vault_folders
    WHERE club_id = _club_id AND team_id IS NULL AND parent_id IS NULL
      AND name = 'Team Admins & Coaches'
      AND restricted_roles @> ARRAY['team_admin'::app_role,'coach'::app_role]
  );
END;
$$;

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
      AND name = 'Coaches'
      AND restricted_roles @> ARRAY['coach'::app_role]
  );

  INSERT INTO vault_folders (club_id, team_id, parent_id, name, restricted_roles)
  SELECT _club_id, _team_id, NULL, 'Team Admins', ARRAY['team_admin'::app_role]
  WHERE NOT EXISTS (
    SELECT 1 FROM vault_folders
    WHERE team_id = _team_id AND parent_id IS NULL
      AND name = 'Team Admins'
      AND restricted_roles @> ARRAY['team_admin'::app_role]
  );

  INSERT INTO vault_folders (club_id, team_id, parent_id, name, restricted_roles)
  SELECT _club_id, _team_id, NULL, 'Team Admins & Coaches', ARRAY['team_admin'::app_role,'coach'::app_role]
  WHERE NOT EXISTS (
    SELECT 1 FROM vault_folders
    WHERE team_id = _team_id AND parent_id IS NULL
      AND name = 'Team Admins & Coaches'
      AND restricted_roles @> ARRAY['team_admin'::app_role,'coach'::app_role]
  );
END;
$$;
