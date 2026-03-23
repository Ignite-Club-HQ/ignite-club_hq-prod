
-- When a user joins a team or club, notify them about upcoming (non-cancelled) events
CREATE OR REPLACE FUNCTION public.notify_new_member_upcoming_events()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  event_record RECORD;
  notification_count integer := 0;
BEGIN
  -- Only process new role assignments
  IF TG_OP != 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- Find upcoming, non-cancelled events for the team or club the user just joined
  FOR event_record IN
    SELECT id, title
    FROM public.events
    WHERE is_cancelled = false
      AND event_date >= CURRENT_DATE
      AND (
        (NEW.team_id IS NOT NULL AND team_id = NEW.team_id)
        OR (NEW.team_id IS NULL AND NEW.club_id IS NOT NULL AND club_id = NEW.club_id AND team_id IS NULL)
      )
    ORDER BY event_date ASC
    LIMIT 50
  LOOP
    -- Insert notification only if one doesn't already exist for this user+event
    INSERT INTO public.notifications (user_id, type, message, related_id, skip_push)
    VALUES (
      NEW.user_id,
      'event_invite',
      'You''ve been invited to: ' || COALESCE(event_record.title, 'an event'),
      event_record.id,
      true
    )
    ON CONFLICT DO NOTHING;

    notification_count := notification_count + 1;
  END LOOP;

  -- If we created notifications, dispatch push notifications asynchronously
  IF notification_count > 0 THEN
    PERFORM net.http_post(
      url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/notify-new-member-events',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as'
      ),
      body := jsonb_build_object(
        'userId', NEW.user_id,
        'teamId', NEW.team_id,
        'clubId', NEW.club_id
      )
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_new_member_upcoming_events failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;

-- Create the trigger on user_roles
CREATE TRIGGER on_new_member_notify_upcoming_events
  AFTER INSERT ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_new_member_upcoming_events();
