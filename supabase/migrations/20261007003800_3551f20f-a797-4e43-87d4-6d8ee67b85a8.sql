ALTER TABLE public.events ADD COLUMN IF NOT EXISTS duty_team_id uuid NULL REFERENCES public.teams(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_events_duty_team_id ON public.events(duty_team_id) WHERE duty_team_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_event_duty_team()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t record;
BEGIN
  IF NEW.duty_team_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.duty_team_id IS NOT DISTINCT FROM OLD.duty_team_id
     AND NEW.club_id IS NOT DISTINCT FROM OLD.club_id THEN RETURN NEW; END IF;
  SELECT club_id, is_archived, deleted_at INTO t FROM public.teams WHERE id = NEW.duty_team_id;
  IF NOT FOUND OR t.deleted_at IS NOT NULL OR t.is_archived THEN
    RAISE EXCEPTION 'Team on duty must be an active team' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.club_id IS NULL OR t.club_id IS DISTINCT FROM NEW.club_id THEN
    RAISE EXCEPTION 'Team on duty must belong to the event''s club' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.validate_event_duty_team() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_validate_event_duty_team
BEFORE INSERT OR UPDATE OF duty_team_id, club_id ON public.events
FOR EACH ROW EXECUTE FUNCTION public.validate_event_duty_team();