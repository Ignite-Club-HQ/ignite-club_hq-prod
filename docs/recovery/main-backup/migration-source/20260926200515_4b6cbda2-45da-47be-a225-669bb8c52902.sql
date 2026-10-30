REVOKE EXECUTE ON FUNCTION public.mirror_competition_photo_to_vault(uuid) FROM authenticated;

CREATE OR REPLACE FUNCTION public.tg_photos_mirror_competition_vault()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.competition_id IS NOT NULL THEN
    BEGIN
      PERFORM public.mirror_competition_photo_to_vault(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'competition vault mirror failed for photo %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_photos_mirror_competition_vault() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_photos_mirror_competition_vault ON public.photos;
CREATE TRIGGER trg_photos_mirror_competition_vault
  AFTER INSERT ON public.photos
  FOR EACH ROW EXECUTE FUNCTION public.tg_photos_mirror_competition_vault();