-- Create a trigger function to send enrolment notification emails
CREATE OR REPLACE FUNCTION public.notify_enrolment_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  child_name text;
  class_name text;
  club_name text;
  term_name text;
  recipient_id uuid;
  supabase_url text;
  anon_key text;
  enrolment_status text;
BEGIN
  supabase_url := 'https://yabcfiuntwqjwvschnji.supabase.co';
  anon_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as';

  -- Get class/club info
  SELECT t.name, c.name INTO class_name, club_name
  FROM teams t
  JOIN clubs c ON c.id = t.club_id
  WHERE t.id = NEW.team_id;

  -- Get term name
  SELECT name INTO term_name FROM terms WHERE id = NEW.term_id;

  -- Determine recipient and child name
  IF NEW.child_id IS NOT NULL THEN
    SELECT c.name, c.parent_id INTO child_name, recipient_id
    FROM children c WHERE c.id = NEW.child_id;
  ELSE
    recipient_id := NEW.user_id;
    child_name := NULL;
  END IF;

  IF recipient_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Determine status for email
  IF TG_OP = 'UPDATE' AND OLD.status = 'waitlisted' AND NEW.status = 'enrolled' THEN
    enrolment_status := 'promoted';
  ELSE
    enrolment_status := NEW.status;
  END IF;

  -- Only send for enrolled or waitlisted (or promoted)
  IF enrolment_status NOT IN ('enrolled', 'waitlisted', 'promoted') THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/send-enrolment-notification-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key
    ),
    body := jsonb_build_object(
      'recipientUserId', recipient_id,
      'childName', child_name,
      'className', COALESCE(class_name, 'Class'),
      'clubName', COALESCE(club_name, 'Organisation'),
      'status', enrolment_status,
      'termName', term_name
    )
  );

  RETURN NEW;
END;
$$;

-- Trigger on insert (new enrolment) and update (waitlist promotion)
CREATE TRIGGER on_class_enrolment_notify
  AFTER INSERT OR UPDATE OF status ON public.class_enrolments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_enrolment_email();