ALTER TABLE public.competition_divisions
  ADD COLUMN IF NOT EXISTS play_weekdays integer[],
  ADD COLUMN IF NOT EXISTS day_start_time time without time zone NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS day_end_time time without time zone NOT NULL DEFAULT '16:00';

-- Sanity: weekdays must be 0..6
CREATE OR REPLACE FUNCTION public.validate_competition_division_weekdays()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.play_weekdays IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM unnest(NEW.play_weekdays) AS d WHERE d < 0 OR d > 6) THEN
      RAISE EXCEPTION 'play_weekdays values must be between 0 (Sun) and 6 (Sat)';
    END IF;
  END IF;
  IF NEW.day_end_time <= NEW.day_start_time THEN
    RAISE EXCEPTION 'day_end_time must be after day_start_time';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_competition_division_weekdays ON public.competition_divisions;
CREATE TRIGGER trg_validate_competition_division_weekdays
BEFORE INSERT OR UPDATE ON public.competition_divisions
FOR EACH ROW EXECUTE FUNCTION public.validate_competition_division_weekdays();