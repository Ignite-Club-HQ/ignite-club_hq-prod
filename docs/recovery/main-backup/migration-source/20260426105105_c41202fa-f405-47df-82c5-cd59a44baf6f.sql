-- =========================================================
-- PHOTO ALBUMS: group photos uploaded together under one caption
-- =========================================================

-- 1. photo_albums table
CREATE TABLE public.photo_albums (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  caption TEXT,
  club_id UUID,
  team_id UUID,
  mini_league_id UUID,
  event_id UUID,
  uploader_id UUID NOT NULL,
  cover_photo_id UUID,
  photo_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_photo_albums_club ON public.photo_albums(club_id);
CREATE INDEX idx_photo_albums_team ON public.photo_albums(team_id);
CREATE INDEX idx_photo_albums_event ON public.photo_albums(event_id);
CREATE INDEX idx_photo_albums_mini_league ON public.photo_albums(mini_league_id);
CREATE INDEX idx_photo_albums_uploader ON public.photo_albums(uploader_id);
CREATE INDEX idx_photo_albums_created ON public.photo_albums(created_at DESC);

-- 2. Add album_id to photos
ALTER TABLE public.photos
  ADD COLUMN album_id UUID REFERENCES public.photo_albums(id) ON DELETE SET NULL;

CREATE INDEX idx_photos_album ON public.photos(album_id);

-- 3. Enable RLS
ALTER TABLE public.photo_albums ENABLE ROW LEVEL SECURITY;

-- Albums are visible to anyone who can see at least one photo in them.
-- Simplest: mirror "visible to authenticated users in same scope".
-- Use a security-definer function tied to existing photo visibility.
CREATE OR REPLACE FUNCTION public.can_view_album(_album_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
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

CREATE POLICY "Albums are viewable in scope"
ON public.photo_albums
FOR SELECT
TO authenticated
USING (public.can_view_album(id));

CREATE POLICY "Users can create their own albums"
ON public.photo_albums
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = uploader_id);

CREATE POLICY "Uploaders can update their own albums"
ON public.photo_albums
FOR UPDATE
TO authenticated
USING (auth.uid() = uploader_id);

CREATE POLICY "Uploaders can delete their own albums"
ON public.photo_albums
FOR DELETE
TO authenticated
USING (auth.uid() = uploader_id);

-- 4. Trigger: keep photo_count and cover_photo_id in sync
CREATE OR REPLACE FUNCTION public.sync_album_aggregates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_album UUID;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    affected_album := NEW.album_id;
  ELSIF (TG_OP = 'DELETE') THEN
    affected_album := OLD.album_id;
  ELSIF (TG_OP = 'UPDATE') THEN
    -- Handle moving a photo between albums
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

CREATE TRIGGER trg_photos_sync_album_aggregates
AFTER INSERT OR UPDATE OR DELETE ON public.photos
FOR EACH ROW
EXECUTE FUNCTION public.sync_album_aggregates();

-- 5. updated_at trigger for albums
CREATE TRIGGER trg_photo_albums_updated_at
BEFORE UPDATE ON public.photo_albums
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 6. BACKFILL: group existing photos by uploader + scope within a 5-minute window
-- Strategy: assign a "group key" using a window where successive photos by the
-- same uploader/scope within 5 minutes belong to the same album.
DO $$
DECLARE
  rec RECORD;
  current_album_id UUID;
  prev_uploader UUID;
  prev_club UUID;
  prev_team UUID;
  prev_event UUID;
  prev_ml UUID;
  prev_time TIMESTAMPTZ;
  same_group BOOLEAN;
BEGIN
  FOR rec IN
    SELECT id, uploader_id, club_id, team_id, event_id, mini_league_id, caption, created_at
    FROM public.photos
    WHERE album_id IS NULL
    ORDER BY uploader_id, club_id, team_id, event_id, mini_league_id, created_at
  LOOP
    same_group :=
      prev_uploader IS NOT DISTINCT FROM rec.uploader_id
      AND prev_club IS NOT DISTINCT FROM rec.club_id
      AND prev_team IS NOT DISTINCT FROM rec.team_id
      AND prev_event IS NOT DISTINCT FROM rec.event_id
      AND prev_ml IS NOT DISTINCT FROM rec.mini_league_id
      AND prev_time IS NOT NULL
      AND rec.created_at - prev_time <= INTERVAL '5 minutes';

    IF NOT same_group OR current_album_id IS NULL THEN
      INSERT INTO public.photo_albums
        (caption, club_id, team_id, mini_league_id, event_id, uploader_id, created_at, updated_at)
      VALUES
        (rec.caption, rec.club_id, rec.team_id, rec.mini_league_id, rec.event_id,
         COALESCE(rec.uploader_id, '00000000-0000-0000-0000-000000000000'::uuid),
         rec.created_at, rec.created_at)
      RETURNING id INTO current_album_id;
    END IF;

    UPDATE public.photos SET album_id = current_album_id WHERE id = rec.id;

    prev_uploader := rec.uploader_id;
    prev_club := rec.club_id;
    prev_team := rec.team_id;
    prev_event := rec.event_id;
    prev_ml := rec.mini_league_id;
    prev_time := rec.created_at;
  END LOOP;
END $$;

-- The trigger above will have populated photo_count and cover_photo_id for all backfilled albums.
