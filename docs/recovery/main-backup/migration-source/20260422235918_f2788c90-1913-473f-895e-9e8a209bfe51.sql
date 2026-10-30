-- Create a trigger function that enforces the new storage path prefix on photos
CREATE OR REPLACE FUNCTION public.enforce_photo_storage_prefix()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.image_url IS NULL OR NEW.image_url NOT LIKE 'clubs/%' THEN
    RAISE EXCEPTION 'Invalid image_url: photos must be uploaded under the clubs/ prefix (got: %)', NEW.image_url
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_photo_storage_prefix_trigger ON public.photos;
CREATE TRIGGER enforce_photo_storage_prefix_trigger
BEFORE INSERT OR UPDATE OF image_url ON public.photos
FOR EACH ROW
EXECUTE FUNCTION public.enforce_photo_storage_prefix();