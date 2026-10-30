CREATE OR REPLACE FUNCTION public.ensure_competition_vault(_competition_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_comp record; v_root uuid; v_url text;
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

  -- Per-team subfolders are intentionally no longer created: each team's files
  -- live in its own team vault, listed once under the club's Teams section.

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

-- Tidy existing empty per-team competition folders.
UPDATE public.vault_folders vf SET deleted_at = now()
 WHERE vf.competition_team_id IS NOT NULL AND vf.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.vault_files f WHERE f.folder_id = vf.id AND f.deleted_at IS NULL)
   AND NOT EXISTS (SELECT 1 FROM public.vault_folders s WHERE s.parent_id = vf.id AND s.deleted_at IS NULL);