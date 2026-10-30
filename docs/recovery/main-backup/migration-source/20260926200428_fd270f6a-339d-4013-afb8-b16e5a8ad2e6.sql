CREATE OR REPLACE FUNCTION public.mirror_competition_photo_to_vault(_photo_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; v_root uuid; v_club uuid; v_id uuid;
BEGIN
  SELECT id, competition_id, uploader_id, image_url, file_url, file_size, title
    INTO p FROM public.photos WHERE id = _photo_id AND deleted_at IS NULL;
  IF p.id IS NULL OR p.competition_id IS NULL THEN RETURN NULL; END IF;
  IF auth.uid() IS NOT NULL AND p.uploader_id <> auth.uid()
     AND NOT public.can_manage_competition_media(auth.uid(), p.competition_id) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  v_root := public.ensure_competition_vault(p.competition_id);
  IF v_root IS NULL THEN RETURN NULL; END IF;
  SELECT club_id INTO v_club FROM public.vault_folders WHERE id = v_root;
  SELECT id INTO v_id FROM public.vault_files
   WHERE folder_id = v_root AND file_url = COALESCE(p.file_url, p.image_url) AND deleted_at IS NULL LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.vault_files (folder_id, club_id, name, file_url, file_size, file_type, uploaded_by, competition_id)
  VALUES (v_root, v_club,
          COALESCE(NULLIF(p.title,''), regexp_replace(COALESCE(p.file_url, p.image_url), '^.*/', '')),
          COALESCE(p.file_url, p.image_url), p.file_size,
          CASE WHEN COALESCE(p.file_url, p.image_url) ~* '\.(mp4|mov|webm|m4v)$' THEN 'video/mp4' ELSE 'image/jpeg' END,
          p.uploader_id, p.competition_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.mirror_competition_photo_to_vault(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mirror_competition_photo_to_vault(uuid) TO authenticated, service_role;

UPDATE public.photos SET show_in_feed = true
 WHERE competition_id IS NOT NULL AND deleted_at IS NULL AND show_in_feed IS DISTINCT FROM true;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM public.photos WHERE competition_id IS NOT NULL AND deleted_at IS NULL LOOP
    PERFORM public.mirror_competition_photo_to_vault(r.id);
  END LOOP;
END $$;