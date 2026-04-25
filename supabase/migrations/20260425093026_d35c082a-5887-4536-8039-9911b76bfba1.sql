-- Update the photo storage prefix validation trigger to accept either:
--   1. A relative path starting with 'clubs/' (e.g. 'clubs/<club_id>/...')
--   2. A full Supabase URL whose object path is in the photos bucket under clubs/
-- This restores the safety guarantee (photos must live under the clubs/<id>/ hierarchy)
-- without rejecting the full public URLs the app currently stores in image_url.

CREATE OR REPLACE FUNCTION public.enforce_photo_storage_prefix()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.image_url IS NULL THEN
    RAISE EXCEPTION 'Invalid image_url: image_url is required'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Accept either a relative path or any Supabase storage URL variant
  -- that points into the photos bucket under the clubs/ prefix.
  IF NEW.image_url LIKE 'clubs/%'
     OR NEW.image_url LIKE '%/storage/v1/object/public/photos/clubs/%'
     OR NEW.image_url LIKE '%/storage/v1/object/sign/photos/clubs/%'
     OR NEW.image_url LIKE '%/storage/v1/object/authenticated/photos/clubs/%'
     OR NEW.image_url LIKE '%/storage/v1/render/image/public/photos/clubs/%'
     OR NEW.image_url LIKE '%/storage/v1/render/image/sign/photos/clubs/%'
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid image_url: photos must be uploaded under the clubs/ prefix (got: %)', NEW.image_url
    USING ERRCODE = 'check_violation';
END;
$$;