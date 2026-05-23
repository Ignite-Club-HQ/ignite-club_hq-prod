-- Fix 1: send_push_notification — prefs.system_enabled does not exist
CREATE OR REPLACE FUNCTION public.send_push_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  notification_url text;
  prefs RECORD;
  category text;
  should_send boolean := true;
  request_id bigint;
  notification_tag text;
  resolved_photo_id uuid;
  notification_title text;
  v_team_id uuid;
  v_club_id uuid;
BEGIN
  IF NEW.skip_push = true THEN
    RETURN NEW;
  END IF;

  SELECT * INTO prefs FROM public.notification_preferences WHERE user_id = NEW.user_id;

  CASE
    WHEN NEW.type IN ('team_message', 'club_message', 'group_message', 'broadcast', 'message_reply', 'message_reaction', 'message_mention', 'direct_message') THEN
      category := 'messages';
    WHEN NEW.type IN ('event_invite', 'event_cancelled', 'event_reminder', 'event_view_reminder', 'event_updated', 'rsvp_reminder', 'rsvp_updated', 'duty_assigned') THEN
      category := 'events';
    WHEN NEW.type IN ('photo_uploaded', 'photo_reaction', 'photo_comment', 'comment_reaction', 'comment_reply') THEN
      category := 'media';
    WHEN NEW.type IN ('membership', 'join_request', 'join_request_approved', 'join_request_denied', 'join_request_processed', 'role_assigned', 'role_removed', 'team_invite', 'team_join', 'club_join', 'member_joined', 'invite_accepted') THEN
      category := 'membership';
    ELSE
      category := 'system';
  END CASE;

  IF prefs.user_id IS NOT NULL THEN
    CASE category
      WHEN 'messages' THEN should_send := COALESCE(prefs.messages_enabled, true);
      WHEN 'events' THEN should_send := COALESCE(prefs.events_enabled, true);
      WHEN 'media' THEN should_send := COALESCE(prefs.media_enabled, true);
      WHEN 'membership' THEN should_send := COALESCE(prefs.membership_enabled, true);
      ELSE should_send := true; -- system category: no per-user toggle column exists
    END CASE;
  END IF;

  IF NOT should_send THEN
    RETURN NEW;
  END IF;

  CASE NEW.type
    WHEN 'direct_message' THEN
      notification_url := '/messages/dm/' || COALESCE(NEW.related_id::text, '');
    WHEN 'team_message', 'message_reaction', 'message_reply', 'message_mention' THEN
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/messages/' || NEW.related_id ELSE '/messages' END;
    WHEN 'club_message' THEN
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/messages/club/' || NEW.related_id ELSE '/messages' END;
    WHEN 'group_message' THEN
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/groups/' || NEW.related_id ELSE '/messages' END;
    WHEN 'broadcast' THEN notification_url := '/messages/broadcast';
    WHEN 'event_invite', 'event_cancelled', 'event_reminder', 'event_view_reminder', 'event_updated', 'rsvp_reminder', 'rsvp_updated', 'duty_assigned' THEN
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/events/' || NEW.related_id ELSE '/events' END;
    WHEN 'pending_sub', 'formation_change', 'half_time', 'game_finished', 'pitch_board', 'substitution', 'player_of_match' THEN
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/events/' || NEW.related_id ELSE '/events' END;
    WHEN 'photo_uploaded' THEN
      v_team_id := NULL;
      v_club_id := NULL;
      IF NEW.related_id IS NOT NULL THEN
        SELECT team_id, club_id INTO v_team_id, v_club_id
        FROM public.photos WHERE id = NEW.related_id AND deleted_at IS NULL;
      END IF;
      IF v_team_id IS NOT NULL THEN
        notification_url := '/media?team=' || v_team_id::text;
      ELSIF v_club_id IS NOT NULL THEN
        notification_url := '/media?club=' || v_club_id::text;
      ELSE
        notification_url := '/media';
      END IF;
    ELSE
      notification_url := '/';
  END CASE;

  notification_title := COALESCE(NEW.title, 'Notification');
  notification_tag := COALESCE(NEW.type, 'generic') || ':' || COALESCE(NEW.related_id::text, NEW.id::text);

  SELECT net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object(
      'userId', NEW.user_id,
      'title', notification_title,
      'body', COALESCE(NEW.body, ''),
      'url', notification_url,
      'tag', notification_tag,
      'notificationId', NEW.id,
      'data', jsonb_build_object('type', NEW.type, 'relatedId', NEW.related_id)
    )
  ) INTO request_id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the insert because push delivery failed
  RETURN NEW;
END;
$function$;

-- Fix 2: get_engagement_streak — awarded_date is a date column, not text
CREATE OR REPLACE FUNCTION public.get_engagement_streak(_user_id uuid, _club_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  streak integer := 0;
  check_date date := CURRENT_DATE;
  has_activity boolean;
BEGIN
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM points_cooldowns
      WHERE user_id = _user_id
        AND club_id = _club_id
        AND awarded_date = check_date
    ) INTO has_activity;

    IF has_activity THEN
      streak := streak + 1;
      check_date := check_date - 1;
    ELSE
      IF streak = 0 AND check_date = CURRENT_DATE THEN
        check_date := check_date - 1;
      ELSE
        EXIT;
      END IF;
    END IF;

    IF streak >= 30 THEN EXIT; END IF;
  END LOOP;

  RETURN streak;
END;
$function$;