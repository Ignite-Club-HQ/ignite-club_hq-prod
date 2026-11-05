
-- Recreate the send_push_notification function with fixes for pg_net reliability
-- Key changes:
-- 1. Remove timeout_milliseconds parameter (use default 5000ms - some pg_net versions have bugs with custom timeout)
-- 2. Add 'net' to search_path so net.http_post is resolvable
-- 3. Simplified error handling with better logging
CREATE OR REPLACE FUNCTION public.send_push_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  notification_url text;
  prefs RECORD;
  category text;
  should_send boolean := true;
  request_id bigint;
BEGIN
  SELECT * INTO prefs FROM public.notification_preferences WHERE user_id = NEW.user_id;
  
  -- Category mapping
  CASE 
    WHEN NEW.type IN ('team_message', 'club_message', 'group_message', 'broadcast', 'message_reply', 'message_reaction', 'message_mention', 'direct_message') THEN
      category := 'messages';
    WHEN NEW.type IN ('event_invite', 'event_cancelled', 'event_reminder', 'event_updated', 'rsvp_reminder', 'duty_assigned') THEN
      category := 'events';
    WHEN NEW.type IN ('photo_uploaded', 'photo_reaction', 'photo_comment', 'comment_reaction', 'comment_reply') THEN
      category := 'media';
    WHEN NEW.type IN ('membership', 'join_request', 'join_request_approved', 'join_request_denied', 'join_request_processed', 'role_assigned', 'role_removed', 'team_invite') THEN
      category := 'membership';
    WHEN NEW.type IN ('pitch_board', 'substitution', 'game_finished', 'pending_sub') THEN
      category := 'pitch_board';
    WHEN NEW.type IN ('subscription_expiring', 'subscription_expired', 'storage_limit', 'system_announcement') THEN
      category := 'admin';
    ELSE
      category := 'other';
  END CASE;
  
  -- Check notification preferences
  IF prefs.id IS NOT NULL THEN
    CASE category
      WHEN 'messages' THEN should_send := prefs.messages_enabled;
      WHEN 'events' THEN should_send := prefs.events_enabled;
      WHEN 'media' THEN should_send := prefs.media_enabled;
      WHEN 'membership' THEN should_send := prefs.membership_enabled;
      WHEN 'pitch_board' THEN should_send := prefs.pitch_board_enabled;
      WHEN 'admin' THEN should_send := true;
      ELSE should_send := true;
    END CASE;
  END IF;
  
  IF NOT should_send THEN
    RETURN NEW;
  END IF;

  -- URL mapping
  CASE NEW.type
    WHEN 'direct_message' THEN 
      notification_url := '/messages/dm/' || COALESCE(NEW.related_id, '');
    WHEN 'team_message', 'message_reply', 'message_reaction', 'message_mention' THEN 
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/messages/' || NEW.related_id ELSE '/messages' END;
    WHEN 'club_message' THEN 
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/messages/club/' || NEW.related_id ELSE '/messages' END;
    WHEN 'group_message' THEN 
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/messages/group/' || NEW.related_id ELSE '/messages' END;
    WHEN 'broadcast' THEN notification_url := '/messages/broadcast';
    WHEN 'event_invite', 'event_cancelled', 'event_reminder', 'event_updated', 'rsvp_reminder' THEN 
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/events/' || NEW.related_id ELSE '/events' END;
    WHEN 'duty_assigned' THEN
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/events/' || NEW.related_id ELSE '/events' END;
    WHEN 'photo_uploaded', 'photo_reaction', 'photo_comment', 'comment_reaction', 'comment_reply' THEN notification_url := '/media';
    WHEN 'points_awarded', 'reward_redeemed', 'player_of_match' THEN notification_url := '/profile?section=points-history';
    WHEN 'membership', 'join_request', 'join_request_approved', 'join_request_denied', 'join_request_processed', 'role_assigned', 'role_removed', 'team_invite' THEN notification_url := '/notifications';
    WHEN 'pitch_board', 'substitution', 'game_finished', 'pending_sub' THEN notification_url := '/notifications';
    WHEN 'subscription_expiring', 'subscription_expired', 'storage_limit', 'system_announcement' THEN notification_url := '/notifications';
    ELSE notification_url := '/notifications';
  END CASE;

  -- Call the push notification edge function via pg_net
  -- Using default timeout (5000ms) for maximum pg_net compatibility
  SELECT net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as'
    ),
    body := jsonb_build_object(
      'userId', NEW.user_id,
      'title', 'Ignite Club HQ',
      'body', NEW.message,
      'url', notification_url,
      'notificationId', NEW.id,
      'tag', NEW.type || '-' || NEW.id,
      'notificationType', NEW.type
    )
  ) INTO request_id;
  
  RAISE LOG 'Push notification queued for user %, request_id: %', NEW.user_id, request_id;
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Push notification trigger failed for notification %: % (SQLSTATE: %)', NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;
