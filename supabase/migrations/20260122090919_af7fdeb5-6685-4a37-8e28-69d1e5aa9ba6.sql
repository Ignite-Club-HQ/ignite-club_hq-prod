CREATE OR REPLACE FUNCTION public.send_push_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  notification_url text;
  prefs RECORD;
  category text;
  should_send boolean := true;
BEGIN
  SELECT * INTO prefs FROM public.notification_preferences WHERE user_id = NEW.user_id;
  
  -- Category mapping - includes direct_message in messages category
  CASE 
    WHEN NEW.type IN ('team_message', 'club_message', 'group_message', 'broadcast', 'message_reply', 'message_reaction', 'message_mention', 'direct_message') THEN
      category := 'messages';
    WHEN NEW.type IN ('event_invite', 'event_cancelled', 'duty_assigned') THEN
      category := 'events';
    WHEN NEW.type IN ('photo_uploaded', 'photo_reaction', 'photo_comment', 'comment_reaction', 'comment_reply') THEN
      category := 'media';
    WHEN NEW.type IN ('join_request', 'join_request_approved', 'join_request_denied', 'join_request_processed') THEN
      category := 'membership';
    WHEN NEW.type IN ('pitch_board', 'substitution', 'game_finished', 'pending_sub') THEN
      category := 'pitch_board';
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
      ELSE should_send := true;
    END CASE;
  END IF;
  
  IF NOT should_send THEN
    RETURN NEW;
  END IF;

  -- URL mapping - includes direct_message
  CASE NEW.type
    WHEN 'team_message', 'message_reply', 'message_reaction', 'message_mention' THEN notification_url := '/messages';
    WHEN 'club_message' THEN notification_url := '/messages';
    WHEN 'group_message' THEN notification_url := '/messages';
    WHEN 'direct_message' THEN notification_url := '/messages';
    WHEN 'broadcast' THEN notification_url := '/broadcast';
    WHEN 'event_invite', 'event_cancelled', 'duty_assigned' THEN notification_url := '/events';
    WHEN 'photo_uploaded', 'photo_reaction', 'photo_comment', 'comment_reaction', 'comment_reply' THEN notification_url := '/media';
    WHEN 'join_request', 'join_request_approved', 'join_request_denied', 'join_request_processed' THEN notification_url := '/notifications';
    WHEN 'pitch_board', 'substitution', 'game_finished', 'pending_sub' THEN notification_url := '/notifications';
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
$$;