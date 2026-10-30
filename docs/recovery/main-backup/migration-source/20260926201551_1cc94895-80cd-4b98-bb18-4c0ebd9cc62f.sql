CREATE OR REPLACE FUNCTION public.enforce_photo_storage_prefix()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.image_url IS NULL THEN
    RAISE EXCEPTION 'Invalid image_url: image_url is required' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.image_url LIKE 'clubs/%'
     OR NEW.image_url LIKE '%/storage/v1/object/public/photos/clubs/%'
     OR NEW.image_url LIKE '%/storage/v1/object/sign/photos/clubs/%'
     OR NEW.image_url LIKE '%/storage/v1/object/authenticated/photos/clubs/%'
     OR NEW.image_url LIKE '%/storage/v1/render/image/public/photos/clubs/%'
     OR NEW.image_url LIKE '%/storage/v1/render/image/sign/photos/clubs/%'
  THEN
    RETURN NEW;
  END IF;

  -- Competition media: must live under competitions/<its own competition_id>/
  IF NEW.competition_id IS NOT NULL AND (
       NEW.image_url LIKE 'competitions/' || NEW.competition_id::text || '/%'
    OR NEW.image_url LIKE '%/storage/v1/object/public/photos/competitions/' || NEW.competition_id::text || '/%'
    OR NEW.image_url LIKE '%/storage/v1/object/sign/photos/competitions/' || NEW.competition_id::text || '/%'
    OR NEW.image_url LIKE '%/storage/v1/object/authenticated/photos/competitions/' || NEW.competition_id::text || '/%'
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid image_url: photos must be uploaded under the clubs/ prefix (got: %)', NEW.image_url
    USING ERRCODE = 'check_violation';
END;
$function$;