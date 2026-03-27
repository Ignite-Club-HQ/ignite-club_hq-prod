CREATE OR REPLACE FUNCTION public.compute_push_notification_url()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  category text;
  notification_url text;
  notification_tag text;
  request_id bigint;
BEGIN
  CASE
    WHEN NEW.type IN ('team_message', 'club_message', 'group_message', 'broadcast', 'message_reply', 'message_reaction', 'message_mention', 'direct_message') THEN
      category := 'messages';
    WHEN NEW.type IN ('event_invite', 'event_cancelled', 'event_reminder', 'event_view_reminder', 'event_updated', 'rsvp_reminder', 'rsvp_updated', 'duty_assigned') THEN
      category := 'events';
    WHEN NEW.type IN ('photo_uploaded', 'photo_reaction', 'photo_comment', 'comment_reaction', 'comment_reply') THEN
      category := 'media';
    WHEN NEW.type IN ('formation_change', 'pending_sub', 'half_time', 'game_finished', 'pitch_board', 'substitution') THEN
      category := 'pitch_board';
    WHEN NEW.type IN ('points_awarded', 'reward_redeemed', 'early_rsvp_points', 'player_of_match', 'game_stats_ready') THEN
      category := 'points';
    WHEN NEW.type IN ('membership', 'join_request', 'join_request_approved', 'join_request_denied', 'join_request_processed',
                       'role_assigned', 'role_removed', 'team_invite', 'invite_accepted', 'team_join', 'club_join', 'member_joined') THEN
      category := 'membership';
    WHEN NEW.type IN ('subscription_expiring', 'subscription_expired', 'subscription_renewed', 'storage_limit', 'reward_available') THEN
      category := 'admin';
    ELSE
      category := 'general';
  END CASE;

  IF category = 'messages' AND EXISTS (
    SELECT 1 FROM notification_preferences WHERE user_id = NEW.user_id AND messages_enabled = false
  ) THEN RETURN NEW; END IF;
  IF category = 'events' AND EXISTS (
    SELECT 1 FROM notification_preferences WHERE user_id = NEW.user_id AND events_enabled = false
  ) THEN RETURN NEW; END IF;
  IF category = 'media' AND EXISTS (
    SELECT 1 FROM notification_preferences WHERE user_id = NEW.user_id AND media_enabled = false
  ) THEN RETURN NEW; END IF;
  IF category = 'membership' AND EXISTS (
    SELECT 1 FROM notification_preferences WHERE user_id = NEW.user_id AND membership_enabled = false
  ) THEN RETURN NEW; END IF;
  IF category = 'pitch_board' AND EXISTS (
    SELECT 1 FROM notification_preferences WHERE user_id = NEW.user_id AND pitch_board_enabled = false
  ) THEN RETURN NEW; END IF;
  IF category = 'points' AND EXISTS (
    SELECT 1 FROM notification_preferences WHERE user_id = NEW.user_id AND points_enabled = false
  ) THEN RETURN NEW; END IF;
  IF category = 'admin' AND EXISTS (
    SELECT 1 FROM notification_preferences WHERE user_id = NEW.user_id AND admin_enabled = false
  ) THEN RETURN NEW; END IF;

  CASE NEW.type
    WHEN 'direct_message' THEN 
      notification_url := '/messages/dm/' || COALESCE(NEW.related_id, '');
    WHEN 'team_message', 'message_reply', 'message_reaction', 'message_mention' THEN 
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/messages/' || NEW.related_id ELSE '/messages' END;
    WHEN 'club_message' THEN 
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/messages/club/' || NEW.related_id ELSE '/messages' END;
    WHEN 'group_message' THEN 
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/groups/' || NEW.related_id ELSE '/messages' END;
    WHEN 'broadcast' THEN notification_url := '/messages/broadcast';
    WHEN 'event_invite', 'event_cancelled', 'event_reminder', 'event_view_reminder', 'event_updated', 'rsvp_reminder', 'rsvp_updated' THEN 
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/events/' || NEW.related_id ELSE '/events' END;
    WHEN 'duty_assigned' THEN
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/events/' || NEW.related_id ELSE '/events' END;
    WHEN 'photo_uploaded', 'photo_reaction', 'photo_comment', 'comment_reaction', 'comment_reply' THEN notification_url := '/media';
    WHEN 'points_awarded', 'reward_redeemed', 'early_rsvp_points', 'player_of_match', 'game_stats_ready' THEN notification_url := '/profile?section=points-history';
    WHEN 'formation_change', 'pending_sub', 'half_time', 'game_finished', 'pitch_board', 'substitution' THEN notification_url := '/';
    WHEN 'team_invite' THEN notification_url := '/notifications';
    WHEN 'join_request', 'join_request_approved', 'join_request_denied', 'join_request_processed' THEN notification_url := '/notifications';
    WHEN 'member_joined' THEN
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/teams/' || NEW.related_id ELSE '/notifications' END;
    WHEN 'invite_accepted', 'team_join', 'club_join' THEN
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/messages/' || NEW.related_id ELSE '/notifications' END;
    WHEN 'role_assigned', 'role_removed', 'membership' THEN notification_url := '/notifications';
    WHEN 'subscription_expiring', 'subscription_expired', 'subscription_renewed', 'storage_limit' THEN notification_url := '/notifications';
    WHEN 'reward_available' THEN notification_url := '/notifications';
    ELSE notification_url := '/notifications';
  END CASE;

  notification_tag := CASE
    WHEN NEW.type = 'formation_change' THEN NEW.type || '-' || NEW.id::text
    ELSE NEW.type || '-' || COALESCE(NEW.related_id, NEW.id)::text
  END;

  SELECT net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as'
    ),
    body := jsonb_build_object(
      'userId', NEW.user_id::text,
      'title', 'Ignite Club HQ',
      'body', NEW.message,
      'url', notification_url,
      'notificationType', NEW.type,
      'tag', notification_tag,
      'relatedId', NEW.related_id::text
    )
  ) INTO request_id;
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Push notification dispatch failed for notification %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;