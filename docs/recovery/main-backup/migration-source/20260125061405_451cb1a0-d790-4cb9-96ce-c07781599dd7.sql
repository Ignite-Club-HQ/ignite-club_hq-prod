-- Create function to send duty assignment email notification
CREATE OR REPLACE FUNCTION public.send_duty_notification_email(
  p_recipient_user_id uuid,
  p_duty_name text,
  p_event_id uuid,
  p_event_title text,
  p_event_date text,
  p_event_time text,
  p_team_name text,
  p_club_name text,
  p_club_logo_url text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  supabase_url text;
  anon_key text;
BEGIN
  supabase_url := 'https://yabcfiuntwqjwvschnji.supabase.co';
  anon_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as';
  
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/send-duty-notification-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key
    ),
    body := jsonb_build_object(
      'recipientUserId', p_recipient_user_id,
      'dutyName', p_duty_name,
      'eventId', p_event_id,
      'eventTitle', COALESCE(p_event_title, 'Upcoming Event'),
      'eventDate', COALESCE(p_event_date, ''),
      'eventTime', COALESCE(p_event_time, ''),
      'teamName', COALESCE(p_team_name, ''),
      'clubName', COALESCE(p_club_name, 'Your Club'),
      'clubLogoUrl', COALESCE(p_club_logo_url, '')
    )
  );
END;
$$;

-- Update the on_duty_assigned trigger function to include email notification
CREATE OR REPLACE FUNCTION public.on_duty_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_record RECORD;
  duty_name text;
  event_date_str text;
  event_time_str text;
BEGIN
  IF NEW.assigned_to IS NOT NULL AND (OLD.assigned_to IS NULL OR OLD.assigned_to != NEW.assigned_to) THEN
    SELECT e.*, t.name as team_name, c.name as club_name, c.logo_url as club_logo_url
    INTO event_record 
    FROM public.events e
    LEFT JOIN public.teams t ON t.id = e.team_id
    LEFT JOIN public.clubs c ON c.id = e.club_id
    WHERE e.id = NEW.event_id;
    
    duty_name := NEW.name;
    
    -- Format date and time strings
    event_date_str := to_char(event_record.event_date AT TIME ZONE 'Australia/Adelaide', 'Day, DD Mon YYYY');
    event_time_str := CASE 
      WHEN event_record.start_time IS NOT NULL THEN to_char(event_record.start_time AT TIME ZONE 'Australia/Adelaide', 'HH12:MI AM')
      ELSE ''
    END;
    
    -- Insert notification
    INSERT INTO public.notifications (user_id, type, message, related_id)
    VALUES (
      NEW.assigned_to, 'duty_assigned',
      'You have been assigned to ' || COALESCE(duty_name, 'a duty') || ' for ' || COALESCE(event_record.title, 'an event'),
      NEW.event_id
    );
    
    -- Send email notification
    PERFORM public.send_duty_notification_email(
      NEW.assigned_to,
      duty_name,
      NEW.event_id,
      event_record.title,
      event_date_str,
      event_time_str,
      event_record.team_name,
      event_record.club_name,
      event_record.club_logo_url
    );
  END IF;
  
  RETURN NEW;
END;
$$;