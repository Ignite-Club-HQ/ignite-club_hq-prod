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
    WHEN NEW.type IN ('pitch_board', 'pitch_board_update', 'substitution', 'substitution_alert', 'game_finished', 'game_ended', 'game_started', 'pending_sub', 'half_time', 'formation_change') THEN
      category := 'pitch_board';
    WHEN NEW.type IN ('subscription_expiring', 'subscription_expired', 'subscription_renewed', 'storage_limit', 'system_announcement', 'admin_alert', 'system_update') THEN
      category := 'admin';
    WHEN NEW.type IN ('points_awarded', 'reward_redeemed', 'reward_available', 'early_rsvp_points') THEN
      category := 'rewards';
    WHEN NEW.type IN ('player_of_match', 'game_stats_ready') THEN
      category := 'pom';
    ELSE
      category := 'other';
  END CASE;
  
  IF prefs.id IS NOT NULL THEN
    CASE category
      WHEN 'messages' THEN should_send := prefs.messages_enabled;
      WHEN 'events' THEN should_send := prefs.events_enabled;
      WHEN 'media' THEN should_send := prefs.media_enabled;
      WHEN 'membership' THEN should_send := prefs.membership_enabled;
      WHEN 'pitch_board' THEN should_send := prefs.pitch_board_enabled;
      WHEN 'admin' THEN should_send := true;
      WHEN 'rewards' THEN should_send := prefs.rewards_enabled;
      WHEN 'pom' THEN should_send := prefs.pom_enabled;
      ELSE should_send := true;
    END CASE;
  END IF;
  
  IF NOT should_send THEN
    RETURN NEW;
  END IF;

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
    WHEN 'event_invite', 'event_cancelled', 'event_reminder', 'event_view_reminder', 'event_updated', 'rsvp_reminder', 'rsvp_updated' THEN 
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/events/' || NEW.related_id ELSE '/events' END;
    WHEN 'duty_assigned' THEN
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/events/' || NEW.related_id ELSE '/events' END;
    WHEN 'photo_uploaded', 'photo_reaction', 'photo_comment', 'comment_reaction', 'comment_reply' THEN notification_url := '/media';
    WHEN 'points_awarded', 'reward_redeemed', 'early_rsvp_points', 'player_of_match', 'game_stats_ready' THEN notification_url := '/profile?section=points-history';
    WHEN 'formation_change', 'pending_sub', 'half_time', 'game_finished', 'pitch_board', 'substitution' THEN notification_url := '/';
    WHEN 'team_invite' THEN notification_url := '/notifications';
    WHEN 'join_request', 'join_request_approved', 'join_request_denied', 'join_request_processed' THEN notification_url := '/notifications';
    WHEN 'membership', 'role_assigned', 'role_removed', 'team_join', 'club_join', 'member_joined', 'invite_accepted' THEN notification_url := '/notifications';
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
      'notificationId', NEW.id::text,
      'tag', notification_tag,
      'notificationType', NEW.type
    )
  ) INTO request_id;

  RETURN NEW;
END;
$function$;