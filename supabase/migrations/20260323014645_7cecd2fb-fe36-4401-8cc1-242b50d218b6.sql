
CREATE OR REPLACE FUNCTION public.on_rsvp_notify_admins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event RECORD;
  v_member_name text;
  v_status text;
  v_message text;
  v_admin RECORD;
BEGIN
  -- Only notify on insert or status change
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Only notify for going/maybe/not_going
  IF NEW.status NOT IN ('going', 'maybe', 'not_going') THEN
    RETURN NEW;
  END IF;

  -- Get event details
  SELECT id, title, team_id, club_id INTO v_event
  FROM public.events
  WHERE id = NEW.event_id;

  IF v_event IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get member display name
  SELECT display_name INTO v_member_name
  FROM public.profiles
  WHERE id = NEW.user_id;

  -- Build human-friendly status
  v_status := CASE NEW.status
    WHEN 'going' THEN 'is going'
    WHEN 'maybe' THEN 'responded maybe'
    WHEN 'not_going' THEN 'can''t go'
  END;

  v_message := COALESCE(v_member_name, 'A member') || ' ' || v_status || ' to ' || COALESCE(v_event.title, 'an event');

  -- Notify team admins for team events, club admins for club events
  IF v_event.team_id IS NOT NULL THEN
    FOR v_admin IN
      SELECT DISTINCT user_id FROM public.user_roles
      WHERE team_id = v_event.team_id
        AND role IN ('team_admin', 'coach')
        AND user_id != NEW.user_id
    LOOP
      INSERT INTO public.notifications (user_id, type, message, related_id)
      VALUES (v_admin.user_id, 'rsvp_updated', v_message, v_event.id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  ELSE
    FOR v_admin IN
      SELECT DISTINCT user_id FROM public.user_roles
      WHERE club_id = v_event.club_id
        AND role IN ('club_admin')
        AND user_id != NEW.user_id
    LOOP
      INSERT INTO public.notifications (user_id, type, message, related_id)
      VALUES (v_admin.user_id, 'rsvp_updated', v_message, v_event.id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger on rsvps table
DROP TRIGGER IF EXISTS on_rsvp_notify_admins_trigger ON public.rsvps;
CREATE TRIGGER on_rsvp_notify_admins_trigger
  AFTER INSERT OR UPDATE OF status ON public.rsvps
  FOR EACH ROW
  EXECUTE FUNCTION public.on_rsvp_notify_admins();
