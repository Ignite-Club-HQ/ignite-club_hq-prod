-- Disable protection trigger temporarily so we can rename the existing role folders.
ALTER TABLE public.vault_folders DISABLE TRIGGER protect_role_folders_trg;

-- Rename existing combined-role folders on every team to "Admin".
UPDATE public.vault_folders
SET name = 'Admin', updated_at = now()
WHERE team_id IS NOT NULL
  AND parent_id IS NULL
  AND name = 'Team Admins & Coaches'
  AND restricted_roles @> ARRAY['team_admin'::app_role, 'coach'::app_role]
  AND array_length(restricted_roles, 1) = 2;

ALTER TABLE public.vault_folders ENABLE TRIGGER protect_role_folders_trg;

-- Update ensure_team_role_folders so future teams get "Admin" instead.
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
  SELECT _club_id, _team_id, NULL, 'Admin', ARRAY['team_admin'::app_role,'coach'::app_role]
  WHERE NOT EXISTS (
    SELECT 1 FROM vault_folders
    WHERE team_id = _team_id AND parent_id IS NULL
      AND restricted_roles @> ARRAY['team_admin'::app_role,'coach'::app_role]
      AND array_length(restricted_roles, 1) = 2
  );
END;
$$;