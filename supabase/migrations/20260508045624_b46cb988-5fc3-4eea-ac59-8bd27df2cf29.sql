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
      ELSE should_send := COALESCE(prefs.system_enabled, true);
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
      notification_url := '/media';
    WHEN 'photo_reaction' THEN
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/media?photo=' || NEW.related_id ELSE '/media' END;
    WHEN 'photo_comment', 'comment_reply' THEN
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/media?photo=' || NEW.related_id || '&comments=1' ELSE '/media' END;
    WHEN 'comment_reaction' THEN
      IF NEW.related_id IS NOT NULL THEN
        SELECT pc.photo_id INTO resolved_photo_id
        FROM public.photo_comments pc
        WHERE pc.id = NEW.related_id;
        IF resolved_photo_id IS NOT NULL THEN
          notification_url := '/media?photo=' || resolved_photo_id || '&comments=1';
        ELSE
          notification_url := '/media';
        END IF;
      ELSE
        notification_url := '/media';
      END IF;
    WHEN 'points_awarded', 'reward_redeemed', 'early_rsvp_points', 'game_stats_ready' THEN notification_url := '/profile?section=points-history';
    WHEN 'team_invite' THEN
      IF NEW.related_id IS NOT NULL THEN
        SELECT pi.team_id INTO notification_url FROM public.pending_invites pi WHERE pi.id = NEW.related_id::uuid;
        IF notification_url IS NOT NULL THEN
          notification_url := '/teams/' || notification_url;
        ELSE
          notification_url := '/notifications';
        END IF;
      ELSE
        notification_url := '/notifications';
      END IF;
    WHEN 'membership', 'member_joined' THEN
      IF NEW.related_id IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM public.mini_leagues WHERE id = NEW.related_id) THEN
          notification_url := '/mini-leagues/' || NEW.related_id;
        ELSIF EXISTS (SELECT 1 FROM public.clubs WHERE id = NEW.related_id) THEN
          notification_url := '/clubs/' || NEW.related_id;
        ELSIF EXISTS (SELECT 1 FROM public.teams WHERE id = NEW.related_id) THEN
          notification_url := '/teams/' || NEW.related_id;
        ELSE
          notification_url := '/notifications';
        END IF;
      ELSE
        notification_url := '/notifications';
      END IF;
    WHEN 'team_join' THEN
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/teams/' || NEW.related_id ELSE '/notifications' END;
    WHEN 'club_join' THEN
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/clubs/' || NEW.related_id ELSE '/notifications' END;
    WHEN 'join_request' THEN notification_url := '/notifications';
    WHEN 'join_request_approved', 'join_request_denied', 'join_request_processed', 'invite_accepted' THEN
      IF NEW.related_id IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM public.clubs WHERE id = NEW.related_id) THEN
          notification_url := '/clubs/' || NEW.related_id;
        ELSIF EXISTS (SELECT 1 FROM public.teams WHERE id = NEW.related_id) THEN
          notification_url := '/teams/' || NEW.related_id;
        ELSE
          notification_url := '/notifications';
        END IF;
      ELSE
        notification_url := '/notifications';
      END IF;
    WHEN 'role_assigned', 'role_removed' THEN notification_url := '/profile';
    WHEN 'role_request' THEN notification_url := '/notifications';
    WHEN 'role_request_approved', 'role_request_denied' THEN notification_url := '/notifications';
    WHEN 'leaderboard_update', 'reward_proximity' THEN notification_url := '/leaderboard';
    WHEN 'season_archived', 'season_published' THEN
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/seasons/' || NEW.related_id ELSE '/seasons' END;
    ELSE notification_url := '/notifications';
  END CASE;

  -- Derive a title from notification type since the notifications table has no title column
  notification_title := CASE NEW.type
    WHEN 'direct_message' THEN 'New message'
    WHEN 'team_message' THEN 'New team message'
    WHEN 'club_message' THEN 'New club message'
    WHEN 'group_message' THEN 'New group message'
    WHEN 'broadcast' THEN 'New broadcast'
    WHEN 'message_reply' THEN 'New reply'
    WHEN 'message_reaction' THEN 'New reaction'
    WHEN 'message_mention' THEN 'You were mentioned'
    WHEN 'event_invite' THEN 'Event invite'
    WHEN 'event_cancelled' THEN 'Event cancelled'
    WHEN 'event_reminder' THEN 'Event reminder'
    WHEN 'event_view_reminder' THEN 'Event update'
    WHEN 'event_updated' THEN 'Event updated'
    WHEN 'rsvp_reminder' THEN 'RSVP reminder'
    WHEN 'rsvp_updated' THEN 'RSVP updated'
    WHEN 'duty_assigned' THEN 'Duty assigned'
    WHEN 'photo_uploaded' THEN 'New photos'
    WHEN 'photo_reaction' THEN 'New reaction'
    WHEN 'photo_comment' THEN 'New comment'
    WHEN 'comment_reaction' THEN 'New reaction'
    WHEN 'comment_reply' THEN 'New reply'
    ELSE 'Ignite'
  END;

  notification_tag := COALESCE(NEW.id::text, '');

  SELECT net.http_post(
    url := 'https://qfjsyiijqbeufaduzttf.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    ),
    body := jsonb_build_object(
      'userId', NEW.user_id,
      'title', notification_title,
      'body', NEW.message,
      'url', notification_url,
      'notificationId', NEW.id,
      'tag', notification_tag,
      'notificationType', NEW.type
    )
  ) INTO request_id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block message/notification inserts on push dispatch errors
  RAISE WARNING 'send_push_notification failed for notification %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;