
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
  v_actor_prefix text;
  v_actor_name text;
  v_admin RECORD;
  v_acting_user_id text;
  v_series_root uuid;
  v_existing RECORD;
  v_count int;
  v_new_message text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('going', 'maybe', 'not_going') THEN
    RETURN NEW;
  END IF;

  v_acting_user_id := current_setting('app.acting_user_id', true);

  SELECT id, title, team_id, club_id, mini_league_id, parent_event_id
  INTO v_event
  FROM public.events WHERE id = NEW.event_id;

  IF v_event IS NULL THEN RETURN NEW; END IF;

  v_series_root := COALESCE(v_event.parent_event_id, v_event.id);

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
    v_actor_name := v_child_name;
  ELSE
    v_actor_name := COALESCE(v_member_name, 'A member');
  END IF;

  v_actor_prefix := v_actor_name || ' %';
  v_message := v_actor_name || ' ' || v_status || ' to ' || COALESCE(v_event.title, 'an event');

  -- Per-admin collapse: if the same actor already triggered an RSVP notification
  -- in the last 30 minutes for another event in the same recurring series,
  -- merge them into a single "X events" notification.
  FOR v_admin IN
    SELECT DISTINCT user_id FROM (
      SELECT ur.user_id
      FROM public.user_roles ur
      JOIN public.mini_leagues ml ON ml.club_id = ur.club_id
      WHERE v_event.mini_league_id IS NOT NULL
        AND ml.id = v_event.mini_league_id
        AND ur.role = 'league_admin'
      UNION
      SELECT user_id FROM public.user_roles
      WHERE v_event.mini_league_id IS NULL
        AND v_event.team_id IS NOT NULL
        AND team_id = v_event.team_id
        AND role IN ('team_admin','coach')
      UNION
      SELECT user_id FROM public.user_roles
      WHERE v_event.mini_league_id IS NULL
        AND v_event.team_id IS NULL
        AND club_id = v_event.club_id
        AND role = 'club_admin'
    ) admins
    WHERE user_id != NEW.user_id
  LOOP
    IF v_acting_user_id IS NOT NULL AND v_admin.user_id::text = v_acting_user_id THEN
      CONTINUE;
    END IF;

    -- Look for an existing recent, unread RSVP notification from this actor
    -- for any event in the same series.
    SELECT n.id, n.message, n.related_id
    INTO v_existing
    FROM public.notifications n
    JOIN public.events e ON e.id = n.related_id
    WHERE n.user_id = v_admin.user_id
      AND n.type IN ('rsvp_updated','rsvp_update')
      AND n.is_read = false
      AND n.created_at > now() - interval '30 minutes'
      AND n.message LIKE v_actor_prefix
      AND COALESCE(e.parent_event_id, e.id) = v_series_root
    ORDER BY n.created_at DESC
    LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      -- Count distinct events in series this actor has RSVP'd to recently
      SELECT COUNT(DISTINCT r.event_id) INTO v_count
      FROM public.rsvps r
      JOIN public.events e ON e.id = r.event_id
      WHERE r.user_id = NEW.user_id
        AND (r.child_id IS NOT DISTINCT FROM NEW.child_id)
        AND COALESCE(e.parent_event_id, e.id) = v_series_root
        AND r.updated_at > now() - interval '30 minutes';

      IF v_count <= 1 THEN
        v_count := 2; -- safety
      END IF;

      v_new_message := v_actor_name || ' ' || v_status || ' to ' || v_count
        || ' ' || COALESCE(v_event.title, 'event') || ' events';

      UPDATE public.notifications
      SET message = v_new_message,
          created_at = now(),
          is_read = false
      WHERE id = v_existing.id;
    ELSE
      INSERT INTO public.notifications (user_id, type, message, related_id)
      VALUES (v_admin.user_id, 'rsvp_updated', v_message, v_event.id)
      ON CONFLICT (user_id, related_id, md5(message))
      WHERE type IN ('rsvp_updated','rsvp_update')
      DO UPDATE SET created_at = now(), is_read = false;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;
