-- Re-declare with explicit search_path (already set, but linter wants it inside CREATE)
CREATE OR REPLACE FUNCTION public.can_view_album(_album_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.photos p
    WHERE p.album_id = _album_id
    LIMIT 1
  ) OR EXISTS (
    SELECT 1 FROM public.photo_albums a
    WHERE a.id = _album_id AND a.uploader_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.sync_album_aggregates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  affected_album UUID;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    affected_album := NEW.album_id;
  ELSIF (TG_OP = 'DELETE') THEN
    affected_album := OLD.album_id;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF NEW.album_id IS DISTINCT FROM OLD.album_id THEN
      IF OLD.album_id IS NOT NULL THEN
        UPDATE public.photo_albums
        SET photo_count = (SELECT COUNT(*) FROM public.photos WHERE album_id = OLD.album_id),
            cover_photo_id = (SELECT id FROM public.photos WHERE album_id = OLD.album_id ORDER BY created_at ASC LIMIT 1),
            updated_at = now()
        WHERE id = OLD.album_id;
      END IF;
    END IF;
    affected_album := NEW.album_id;
  END IF;

  IF affected_album IS NOT NULL THEN
    UPDATE public.photo_albums
    SET photo_count = (SELECT COUNT(*) FROM public.photos WHERE album_id = affected_album),
        cover_photo_id = COALESCE(
          (SELECT id FROM public.photos WHERE album_id = affected_album ORDER BY created_at ASC LIMIT 1),
          cover_photo_id
        ),
        updated_at = now()
    WHERE id = affected_album;
  END IF;

  RETURN NULL;
END;
$$;