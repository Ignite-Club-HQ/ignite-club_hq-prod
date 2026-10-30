
ALTER TABLE public.app_ads
  ADD COLUMN IF NOT EXISTS ad_type text NOT NULL DEFAULT 'image',
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS headline text,
  ADD COLUMN IF NOT EXISTS subtext text,
  ADD COLUMN IF NOT EXISTS cta_label text,
  ADD COLUMN IF NOT EXISTS bg_color text,
  ADD COLUMN IF NOT EXISTS text_color text;

ALTER TABLE public.app_ads
  ALTER COLUMN image_url DROP NOT NULL;

ALTER TABLE public.app_ads
  DROP CONSTRAINT IF EXISTS app_ads_ad_type_check;
ALTER TABLE public.app_ads
  ADD CONSTRAINT app_ads_ad_type_check
  CHECK (ad_type IN ('image', 'logo_text'));

CREATE OR REPLACE FUNCTION public.app_ads_validate_payload()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.ad_type = 'image' THEN
    IF NEW.image_url IS NULL OR length(trim(NEW.image_url)) = 0 THEN
      RAISE EXCEPTION 'image_url is required when ad_type = image';
    END IF;
  ELSIF NEW.ad_type = 'logo_text' THEN
    IF NEW.headline IS NULL OR length(trim(NEW.headline)) = 0 THEN
      RAISE EXCEPTION 'headline is required when ad_type = logo_text';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_ads_validate_payload ON public.app_ads;
CREATE TRIGGER trg_app_ads_validate_payload
BEFORE INSERT OR UPDATE ON public.app_ads
FOR EACH ROW EXECUTE FUNCTION public.app_ads_validate_payload();
