-- Add optional RSVP grouping for club-wide events (game/social with team_id null)
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS rsvp_grouping text;

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_rsvp_grouping_check;
ALTER TABLE public.events
  ADD CONSTRAINT events_rsvp_grouping_check
  CHECK (rsvp_grouping IS NULL OR rsvp_grouping IN ('level', 'team'));

CREATE OR REPLACE FUNCTION public.validate_event_rsvp_grouping()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.rsvp_grouping IS NOT NULL AND NEW.team_id IS NOT NULL THEN
    RAISE EXCEPTION 'rsvp_grouping can only be set on club-wide events (team_id must be NULL)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_event_rsvp_grouping ON public.events;
CREATE TRIGGER trg_validate_event_rsvp_grouping
BEFORE INSERT OR UPDATE OF rsvp_grouping, team_id ON public.events
FOR EACH ROW EXECUTE FUNCTION public.validate_event_rsvp_grouping();