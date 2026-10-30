CREATE OR REPLACE FUNCTION on_rsvp_notify_admins()
RETURNS TRIGGER AS $$
DECLARE
  v_event RECORD;
  v_member_name text;
  v_child_name text;
  v_status text;
  v_message text;
  v_admin RECORD;
  v_acting_user_id text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('going', 'maybe', 'not_going') THEN
    RETURN NEW;
  END IF;

  -- Get the acting user (admin who made the change) from session variable
  v_acting_user_id := current_setting('app.acting_user_id', true);

  SELECT id, title, team_id, club_id, mini_league_id INTO v_event
  FROM public.events WHERE id = NEW.event_id;

  IF v_event IS NULL THEN RETURN NEW; END IF;

  SELECT display_name INTO v_member_name FROM public.profiles WHERE id = NEW.user_id;

  IF NEW.child_id IS NOT NULL THEN
    SELECT name INTO v_child_name FROM public.children WHERE id = NEW.child_id;
  END IF;

  v_status := CASE NEW.status
    WHEN 'going' THEN 'is going'
    WHEN 'maybe' THEN 'responded maybe'
    WHEN 'not_going' THEN 'can''t go'
  END;

  IF v_child_name IS NOT NULL THEN
    v_message := v_child_name || ' ' || v_status || ' to ' || COALESCE(v_event.title, 'an event');
  ELSE
    v_message := COALESCE(v_member_name, 'A member') || ' ' || v_status || ' to ' || COALESCE(v_event.title, 'an event');
  END IF;

  IF v_event.mini_league_id IS NOT NULL THEN
    FOR v_admin IN
      SELECT DISTINCT ur.user_id FROM public.user_roles ur
      JOIN public.mini_leagues ml ON ml.club_id = ur.club_id
      WHERE ml.id = v_event.mini_league_id AND ur.role = 'league_admin' AND ur.user_id != NEW.user_id
    LOOP
      -- Skip the admin who made the change
      IF v_acting_user_id IS NOT NULL AND v_admin.user_id::text = v_acting_user_id THEN
        CONTINUE;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.notifications
        WHERE user_id = v_admin.user_id AND type IN ('rsvp_updated','rsvp_update')
          AND message = v_message AND created_at > now() - interval '60 seconds'
      ) THEN
        INSERT INTO public.notifications (user_id, type, message, related_id)
        VALUES (v_admin.user_id, 'rsvp_updated', v_message, v_event.id);
      END IF;
    END LOOP;
  ELSIF v_event.team_id IS NOT NULL THEN
    FOR v_admin IN
      SELECT DISTINCT user_id FROM public.user_roles
      WHERE team_id = v_event.team_id AND role IN ('team_admin','coach') AND user_id != NEW.user_id
    LOOP
      IF v_acting_user_id IS NOT NULL AND v_admin.user_id::text = v_acting_user_id THEN
        CONTINUE;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.notifications
        WHERE user_id = v_admin.user_id AND type IN ('rsvp_updated','rsvp_update')
          AND message = v_message AND created_at > now() - interval '60 seconds'
      ) THEN
        INSERT INTO public.notifications (user_id, type, message, related_id)
        VALUES (v_admin.user_id, 'rsvp_updated', v_message, v_event.id);
      END IF;
    END LOOP;
  ELSE
    FOR v_admin IN
      SELECT DISTINCT user_id FROM public.user_roles
      WHERE club_id = v_event.club_id AND role IN ('club_admin') AND user_id != NEW.user_id
    LOOP
      IF v_acting_user_id IS NOT NULL AND v_admin.user_id::text = v_acting_user_id THEN
        CONTINUE;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.notifications
        WHERE user_id = v_admin.user_id AND type IN ('rsvp_updated','rsvp_update')
          AND message = v_message AND created_at > now() - interval '60 seconds'
      ) THEN
        INSERT INTO public.notifications (user_id, type, message, related_id)
        VALUES (v_admin.user_id, 'rsvp_updated', v_message, v_event.id);
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;