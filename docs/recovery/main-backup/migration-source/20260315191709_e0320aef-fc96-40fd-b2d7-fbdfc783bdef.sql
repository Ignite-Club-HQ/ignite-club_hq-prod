
-- Function to auto-promote next waitlisted student when someone withdraws
CREATE OR REPLACE FUNCTION public.promote_waitlisted_on_withdrawal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  next_waitlisted RECORD;
BEGIN
  -- Only trigger when status changes to 'withdrawn'
  IF NEW.status = 'withdrawn' AND OLD.status != 'withdrawn' THEN
    -- Find the next waitlisted student for the same class+term (lowest waitlist_position)
    SELECT * INTO next_waitlisted
    FROM class_enrolments
    WHERE team_id = NEW.team_id
      AND term_id = NEW.term_id
      AND status = 'waitlisted'
    ORDER BY waitlist_position ASC NULLS LAST, created_at ASC
    LIMIT 1;

    -- If found, promote them to enrolled
    IF next_waitlisted.id IS NOT NULL THEN
      UPDATE class_enrolments
      SET status = 'enrolled',
          waitlist_position = NULL,
          updated_at = now()
      WHERE id = next_waitlisted.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Create the trigger
DROP TRIGGER IF EXISTS trg_promote_waitlisted_on_withdrawal ON class_enrolments;
CREATE TRIGGER trg_promote_waitlisted_on_withdrawal
  AFTER UPDATE ON class_enrolments
  FOR EACH ROW
  EXECUTE FUNCTION public.promote_waitlisted_on_withdrawal();
