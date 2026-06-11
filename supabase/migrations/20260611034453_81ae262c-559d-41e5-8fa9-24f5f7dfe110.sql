CREATE OR REPLACE FUNCTION public.notify_new_member_upcoming_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  event_record RECORD;
  notification_count integer := 0;
  series_counts jsonb := '{}'::jsonb;
  series_key text;
  current_count integer;
BEGIN
  IF TG_OP != 'INSERT' THEN
    RETURN NEW;
  END IF;

  FOR event_record IN
    SELECT id, title, parent_event_id
    FROM public.events
    WHERE is_cancelled = false
      AND event_date >= CURRENT_DATE
      AND (
        (NEW.team_id IS NOT NULL AND team_id = NEW.team_id)
        OR (NEW.team_id IS NULL AND NEW.club_id IS NOT NULL AND club_id = NEW.club_id AND team_id IS NULL)
      )
      AND (
        restricted_to_roles IS NULL
        OR cardinality(restricted_to_roles) = 0
        OR NEW.role = 'club_admin'::app_role
        OR NEW.role = ANY(restricted_to_roles)
      )
    ORDER BY event_date ASC
    LIMIT 100
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = NEW.user_id
        AND n.type = 'event_invite'
        AND n.related_id = event_record.id
    ) THEN
      CONTINUE;
    END IF;

    IF event_record.parent_event_id IS NOT NULL THEN
      series_key := event_record.parent_event_id::text;
      current_count := COALESCE((series_counts ->> series_key)::integer, 0);
      IF current_count >= 3 THEN
        CONTINUE;
      END IF;
      series_counts := jsonb_set(series_counts, ARRAY[series_key], to_jsonb(current_count + 1));
    END IF;

    INSERT INTO public.notifications (user_id, type, message, related_id, skip_push)
    VALUES (
      NEW.user_id,
      'event_invite',
      'You''ve been invited to: ' || COALESCE(event_record.title, 'an event'),
      event_record.id,
      true
    );

    notification_count := notification_count + 1;
  END LOOP;

  IF notification_count > 0 THEN
    PERFORM net.http_post(
      url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/notify-new-member-events',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.supabase_anon_key', true)
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