CREATE OR REPLACE FUNCTION public.delete_media_photo(_photo_id uuid, _mode text)
RETURNS TABLE (
  photo_id uuid,
  mode text,
  vault_file_id uuid,
  vault_updated boolean,
  already_deleted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _photo public.photos%ROWTYPE;
  _url text;
  _vault_id uuid;
  _now timestamptz := now();
  _authorized boolean := false;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF _mode IS NULL OR _mode NOT IN ('feed_only', 'feed_and_vault') THEN
    RAISE EXCEPTION 'invalid_mode' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _photo FROM public.photos WHERE id = _photo_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Authorization is derived from the STORED photo, never from client input.
  IF public.has_role(_caller, 'app_admin') THEN
    _authorized := true;
  ELSIF _photo.uploader_id = _caller THEN
    _authorized := true;
  ELSIF _photo.club_id IS NOT NULL AND (
      public.has_role(_caller, 'club_admin', _photo.club_id)
      OR public.has_role(_caller, 'committee_member', _photo.club_id)
  ) THEN
    _authorized := true;
  ELSIF _photo.team_id IS NOT NULL
    AND public.has_role(_caller, 'team_admin', _photo.club_id, _photo.team_id) THEN
    _authorized := true;
  END IF;

  IF NOT _authorized THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF _mode = 'feed_only' THEN
    UPDATE public.photos SET show_in_feed = false WHERE id = _photo_id;
    RETURN QUERY SELECT _photo_id, _mode, NULL::uuid, false, (_photo.deleted_at IS NOT NULL);
    RETURN;
  END IF;

  UPDATE public.photos
     SET show_in_feed = false,
         deleted_at = COALESCE(deleted_at, _now)
   WHERE id = _photo_id;

  _url := COALESCE(_photo.file_url, _photo.image_url);

  IF _url IS NOT NULL THEN
    UPDATE public.vault_files v
       SET deleted_at = COALESCE(v.deleted_at, _now),
           deleted_by = COALESCE(v.deleted_by, _caller)
     WHERE v.file_url = _url
     RETURNING v.id INTO _vault_id;
  END IF;

  RETURN QUERY SELECT _photo_id, _mode, _vault_id, (_vault_id IS NOT NULL), (_photo.deleted_at IS NOT NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_media_photo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_media_photo(uuid, text) TO authenticated;