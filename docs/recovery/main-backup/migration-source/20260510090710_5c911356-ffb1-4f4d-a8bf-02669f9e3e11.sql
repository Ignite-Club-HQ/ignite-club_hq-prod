CREATE OR REPLACE FUNCTION public.on_direct_message_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  sender_name text;
  recipient_id uuid;
  conversation_record record;
  has_image boolean;
  notification_url text;
  notification_id uuid;
  request_id bigint;
BEGIN
  SELECT display_name INTO sender_name FROM public.profiles WHERE id = NEW.author_id;
  has_image := NEW.image_url IS NOT NULL AND NEW.image_url != '';

  SELECT * INTO conversation_record FROM public.direct_conversations WHERE id = NEW.conversation_id;

  IF conversation_record.participant_1 = NEW.author_id THEN
    recipient_id := conversation_record.participant_2;
  ELSE
    recipient_id := conversation_record.participant_1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.chat_mute_preferences cmp
    WHERE cmp.user_id = recipient_id 
    AND cmp.chat_id = NEW.conversation_id
    AND cmp.chat_type = 'dm'
    AND (cmp.muted_until IS NULL OR cmp.muted_until > now())
  ) THEN
    -- Insert with skip_push=true so the generic send_push_notification trigger
    -- doesn't fire — we dispatch our own push below with ?message=<id> appended.
    INSERT INTO public.notifications (user_id, type, message, related_id, skip_push)
    VALUES (
      recipient_id, 
      'direct_message', 
      COALESCE(sender_name, 'Someone') || ' sent you a message',
      NEW.conversation_id,
      true
    )
    RETURNING id INTO notification_id;

    notification_url := '/messages/dm/' || NEW.conversation_id::text || '?message=' || NEW.id::text;

    -- Fire the push directly. Use hardcoded URL + anon key (matching the other
    -- message triggers) instead of `current_setting('app.settings.*')` because
    -- those GUCs are NOT configured in this project and were resulting in NULL
    -- URLs that silently dropped every DM push.
    BEGIN
      SELECT net.http_post(
        url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/send-push-notification',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as'
        ),
        body := jsonb_build_object(
          'userId', recipient_id,
          'title', 'Ignite — Messages',
          'body', COALESCE(sender_name, 'Someone') || ' sent you a message',
          'url', notification_url,
          'notificationId', notification_id,
          'tag', 'direct_message-' || notification_id::text,
          'notificationType', 'direct_message'
        )
      ) INTO request_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'DM push dispatch failed for message %: %', NEW.id, SQLERRM;
    END;

    PERFORM public.send_message_notification_email(
      recipient_id,
      NEW.author_id,
      NEW.text,
      'direct',
      NEW.conversation_id,
      NULL,
      NEW.id,
      has_image
    );
  END IF;

  RETURN NEW;
END;
$function$;