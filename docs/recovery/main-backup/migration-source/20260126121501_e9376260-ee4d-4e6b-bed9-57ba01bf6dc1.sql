
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
BEGIN
  SELECT * INTO prefs FROM public.notification_preferences WHERE user_id = NEW.user_id;
  
  -- Category mapping - all notification types from notificationTypes.ts
  CASE 
    -- Message notifications
    WHEN NEW.type IN ('team_message', 'club_message', 'group_message', 'broadcast', 'message_reply', 'message_reaction', 'message_mention', 'direct_message') THEN
      category := 'messages';
    -- Event notifications
    WHEN NEW.type IN ('event_invite', 'event_cancelled', 'event_reminder', 'event_updated', 'rsvp_reminder', 'duty_assigned') THEN
      category := 'events';
    -- Media notifications
    WHEN NEW.type IN ('photo_uploaded', 'photo_reaction', 'photo_comment', 'comment_reaction', 'comment_reply') THEN
      category := 'media';
    -- Membership notifications
    WHEN NEW.type IN ('membership', 'join_request', 'join_request_approved', 'join_request_denied', 'join_request_processed', 'role_assigned', 'role_removed', 'team_invite') THEN
      category := 'membership';
    -- Pitch board notifications
    WHEN NEW.type IN ('pitch_board', 'substitution', 'game_finished', 'pending_sub') THEN
      category := 'pitch_board';
    -- Admin notifications - always send
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
      WHEN 'admin' THEN should_send := true; -- Admin notifications always sent
      ELSE should_send := true;
    END CASE;
  END IF;
  
  IF NOT should_send THEN
    RETURN NEW;
  END IF;

  -- URL mapping - all notification types
  CASE NEW.type
    -- Message types -> /messages
    WHEN 'team_message', 'message_reply', 'message_reaction', 'message_mention' THEN notification_url := '/messages';
    WHEN 'club_message' THEN notification_url := '/messages';
    WHEN 'group_message' THEN notification_url := '/messages';
    WHEN 'direct_message' THEN notification_url := '/messages';
    WHEN 'broadcast' THEN notification_url := '/broadcast';
    -- Event types -> /events
    WHEN 'event_invite', 'event_cancelled', 'event_reminder', 'event_updated', 'rsvp_reminder', 'duty_assigned' THEN notification_url := '/events';
    -- Media types -> /media
    WHEN 'photo_uploaded', 'photo_reaction', 'photo_comment', 'comment_reaction', 'comment_reply' THEN notification_url := '/media';
    -- Membership types -> /notifications
    WHEN 'membership', 'join_request', 'join_request_approved', 'join_request_denied', 'join_request_processed', 'role_assigned', 'role_removed', 'team_invite' THEN notification_url := '/notifications';
    -- Pitch board types -> /notifications
    WHEN 'pitch_board', 'substitution', 'game_finished', 'pending_sub' THEN notification_url := '/notifications';
    -- Admin types -> /notifications
    WHEN 'subscription_expiring', 'subscription_expired', 'storage_limit', 'system_announcement' THEN notification_url := '/notifications';
    ELSE notification_url := '/notifications';
  END CASE;

  -- Call the push notification edge function
  PERFORM net.http_post(
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
      'tag', NEW.type || '-' || NEW.id
    )
  );
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Push notification failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;
