
ALTER TABLE public.vault_folders
  ADD COLUMN IF NOT EXISTS competition_id uuid REFERENCES public.competitions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS competition_team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL;
ALTER TABLE public.vault_files
  ADD COLUMN IF NOT EXISTS competition_id uuid REFERENCES public.competitions(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS vault_folders_competition_root_uidx
  ON public.vault_folders(competition_id) WHERE competition_id IS NOT NULL AND competition_team_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vault_folders_competition_team_uidx
  ON public.vault_folders(competition_id, competition_team_id) WHERE competition_team_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS vault_files_competition_idx ON public.vault_files(competition_id) WHERE competition_id IS NOT NULL;

-- Competition vault items: ONLY competition owners/admins (and app admins).
CREATE POLICY "Competition vault folders restricted to competition admins"
  ON public.vault_folders AS RESTRICTIVE FOR ALL TO authenticated
  USING (competition_id IS NULL OR public.is_competition_role_admin((SELECT auth.uid()), competition_id) OR public.has_role((SELECT auth.uid()), 'app_admin'))
  WITH CHECK (competition_id IS NULL OR public.is_competition_role_admin((SELECT auth.uid()), competition_id) OR public.has_role((SELECT auth.uid()), 'app_admin'));
CREATE POLICY "Competition admins manage competition vault folders"
  ON public.vault_folders FOR ALL TO authenticated
  USING (competition_id IS NOT NULL AND public.is_competition_role_admin((SELECT auth.uid()), competition_id))
  WITH CHECK (competition_id IS NOT NULL AND public.is_competition_role_admin((SELECT auth.uid()), competition_id));

CREATE POLICY "Competition vault files restricted to competition admins"
  ON public.vault_files AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    (competition_id IS NULL AND (folder_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.vault_folders vf WHERE vf.id = vault_files.folder_id AND vf.competition_id IS NOT NULL)))
    OR public.is_competition_role_admin((SELECT auth.uid()), COALESCE(competition_id, (SELECT vf.competition_id FROM public.vault_folders vf WHERE vf.id = vault_files.folder_id)))
    OR public.has_role((SELECT auth.uid()), 'app_admin'))
  WITH CHECK (
    (competition_id IS NULL AND (folder_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.vault_folders vf WHERE vf.id = vault_files.folder_id AND vf.competition_id IS NOT NULL)))
    OR public.is_competition_role_admin((SELECT auth.uid()), COALESCE(competition_id, (SELECT vf.competition_id FROM public.vault_folders vf WHERE vf.id = vault_files.folder_id)))
    OR public.has_role((SELECT auth.uid()), 'app_admin'));
CREATE POLICY "Competition admins manage competition vault files"
  ON public.vault_files FOR ALL TO authenticated
  USING (competition_id IS NOT NULL AND public.is_competition_role_admin((SELECT auth.uid()), competition_id))
  WITH CHECK (competition_id IS NOT NULL AND public.is_competition_role_admin((SELECT auth.uid()), competition_id));

-- Stamp competition_id on any file placed in a competition folder.
CREATE OR REPLACE FUNCTION public.tg_vault_file_stamp_competition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.folder_id IS NOT NULL THEN
    SELECT COALESCE(NEW.competition_id, vf.competition_id) INTO NEW.competition_id
    FROM public.vault_folders vf WHERE vf.id = NEW.folder_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_vault_file_stamp_competition BEFORE INSERT OR UPDATE OF folder_id ON public.vault_files
  FOR EACH ROW EXECUTE FUNCTION public.tg_vault_file_stamp_competition();

CREATE OR REPLACE FUNCTION public.ensure_competition_vault(_competition_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_comp record; v_root uuid; r record; v_url text;
BEGIN
  SELECT id, name, organizer_club_id, created_by, code_of_conduct_path, code_of_conduct_name
    INTO v_comp FROM public.competitions WHERE id = _competition_id;
  IF v_comp.id IS NULL OR v_comp.organizer_club_id IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO v_root FROM public.vault_folders
   WHERE competition_id = _competition_id AND competition_team_id IS NULL AND deleted_at IS NULL;
  IF v_root IS NULL THEN
    INSERT INTO public.vault_folders (club_id, name, created_by, competition_id)
    VALUES (v_comp.organizer_club_id, v_comp.name, v_comp.created_by, _competition_id)
    RETURNING id INTO v_root;
  ELSE
    UPDATE public.vault_folders SET name = v_comp.name, club_id = v_comp.organizer_club_id
     WHERE id = v_root AND (name <> v_comp.name OR club_id IS DISTINCT FROM v_comp.organizer_club_id);
  END IF;

  FOR r IN
    SELECT t.id, t.name || COALESCE(' (' || c.name || ')', '') AS label
    FROM public.competition_entries ce
    JOIN public.teams t ON t.id = ce.team_id
    LEFT JOIN public.clubs c ON c.id = t.club_id
    WHERE ce.competition_id = _competition_id AND ce.status IN ('invited','accepted')
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.vault_folders WHERE competition_id = _competition_id
                   AND competition_team_id = r.id AND deleted_at IS NULL) THEN
      INSERT INTO public.vault_folders (club_id, name, parent_id, created_by, competition_id, competition_team_id)
      VALUES (v_comp.organizer_club_id, r.label, v_root, v_comp.created_by, _competition_id, r.id);
    END IF;
  END LOOP;

  -- Code of Conduct: keep exactly one live copy in the competition folder.
  UPDATE public.vault_files SET deleted_at = now()
   WHERE competition_id = _competition_id AND storage_bucket = 'competition-documents'
     AND deleted_at IS NULL
     AND (v_comp.code_of_conduct_path IS NULL OR storage_path <> v_comp.code_of_conduct_path);
  IF v_comp.code_of_conduct_path IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.vault_files WHERE competition_id = _competition_id
        AND storage_bucket = 'competition-documents' AND storage_path = v_comp.code_of_conduct_path AND deleted_at IS NULL) THEN
    v_url := 'https://ecsdwrarzfexssxtrymj.supabase.co/storage/v1/object/authenticated/competition-documents/' || v_comp.code_of_conduct_path;
    INSERT INTO public.vault_files (folder_id, club_id, name, file_url, file_type, uploaded_by, storage_bucket, storage_path, competition_id)
    VALUES (v_root, v_comp.organizer_club_id, COALESCE(v_comp.code_of_conduct_name, 'Code of Conduct.pdf'), v_url,
            CASE WHEN v_comp.code_of_conduct_path ILIKE '%.pdf' THEN 'application/pdf' ELSE NULL END,
            v_comp.created_by, 'competition-documents', v_comp.code_of_conduct_path, _competition_id);
  END IF;
  RETURN v_root;
END $$;
REVOKE ALL ON FUNCTION public.ensure_competition_vault(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_competition_ensure_vault()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ensure_competition_vault(NEW.competition_id);
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.tg_competition_row_ensure_vault()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ensure_competition_vault(NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_competition_row_ensure_vault
  AFTER INSERT OR UPDATE OF name, organizer_club_id, code_of_conduct_path, code_of_conduct_name ON public.competitions
  FOR EACH ROW EXECUTE FUNCTION public.tg_competition_row_ensure_vault();
CREATE TRIGGER trg_competition_entry_ensure_vault
  AFTER INSERT OR UPDATE OF status ON public.competition_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_competition_ensure_vault();

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM public.competitions WHERE organizer_club_id IS NOT NULL LOOP
    PERFORM public.ensure_competition_vault(r.id);
  END LOOP;
END $$;
