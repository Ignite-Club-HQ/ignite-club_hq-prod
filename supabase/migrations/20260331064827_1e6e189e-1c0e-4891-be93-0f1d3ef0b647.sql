CREATE OR REPLACE FUNCTION public.on_rsvp_notify_admins()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event RECORD;
  v_member_name text;
  v_child_name text;
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
  SELECT id, title, team_id, club_id, mini_league_id INTO v_event
  FROM public.events
  WHERE id = NEW.event_id;

  IF v_event IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get member display name
  SELECT display_name INTO v_member_name
  FROM public.profiles
  WHERE id = NEW.user_id;

  -- If this RSVP is for a child, use the child's name instead
  IF NEW.child_id IS NOT NULL THEN
    SELECT name INTO v_child_name
    FROM public.children
    WHERE id = NEW.child_id;
  END IF;

  -- Build human-friendly status
  v_status := CASE NEW.status
    WHEN 'going' THEN 'is going'
    WHEN 'maybe' THEN 'responded maybe'
    WHEN 'not_going' THEN 'can''t go'
  END;

  -- Use child name if this is a child RSVP, otherwise parent name
  IF v_child_name IS NOT NULL THEN
    v_message := v_child_name || ' ' || v_status || ' to ' || COALESCE(v_event.title, 'an event');
  ELSE
    v_message := COALESCE(v_member_name, 'A member') || ' ' || v_status || ' to ' || COALESCE(v_event.title, 'an event');
  END IF;

  -- Mini-league events: notify league admins only (NOT club admins)
  IF v_event.mini_league_id IS NOT NULL THEN
    FOR v_admin IN
      SELECT DISTINCT ur.user_id FROM public.user_roles ur
      JOIN public.mini_leagues ml ON ml.club_id = ur.club_id
      WHERE ml.id = v_event.mini_league_id
        AND ur.role = 'league_admin'
        AND ur.user_id != NEW.user_id
    LOOP
      INSERT INTO public.notifications (user_id, type, message, related_id)
      VALUES (v_admin.user_id, 'rsvp_updated', v_message, v_event.id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  -- Team events: notify team admins and coaches
  ELSIF v_event.team_id IS NOT NULL THEN
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
  -- Club-wide events: notify club admins
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
$function$;