
-- Shared helper: strip mention tokens and replace special chat tokens with
-- friendly labels for push body previews. Mirrors the TS helper in
-- supabase/functions/process-message-notifications/index.ts.
CREATE OR REPLACE FUNCTION public.format_message_preview(_text text, _has_image boolean DEFAULT false)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  out_text text;
BEGIN
  IF _text IS NULL OR btrim(_text) = '' THEN
    RETURN CASE WHEN _has_image THEN '📷 Photo' ELSE '' END;
  END IF;
  out_text := _text;
  out_text := regexp_replace(out_text, '\[event:[0-9a-f-]{36}\]', '📅 Event', 'gi');
  out_text := regexp_replace(out_text, '\[poll:[0-9a-f-]{36}\]', '📊 Poll', 'gi');
  out_text := regexp_replace(out_text, '\[board:[0-9a-f-]{36}\]', '🏟️ Live board', 'gi');
  out_text := regexp_replace(out_text, '\[galleryprompt:[0-9a-f-]{36}\]', '📸 Reminder', 'gi');
  out_text := regexp_replace(out_text, '\[gallery:[0-9a-f-]{36}\]', '📸 Team photos', 'gi');
  out_text := regexp_replace(out_text, '\[publish:[0-9a-f-]{36}\]', '', 'gi');
  out_text := regexp_replace(out_text, '\[vaultroot:team:[0-9a-f-]{36}\]', '🗂️ Team vault', 'gi');
  out_text := regexp_replace(out_text, '\[vaultroot:club:[0-9a-f-]{36}\]', '🗂️ Club vault', 'gi');
  out_text := regexp_replace(out_text, '\[vaultfolder:[0-9a-f-]{36}\]', '📁 Folder', 'gi');
  out_text := regexp_replace(out_text, '\[vault:[0-9a-f-]{36}\]', '📎 File', 'gi');
  -- Markdown links [label](url) -> label
  out_text := regexp_replace(out_text, '\[([^\]]+)\]\((https?://[^)]+)\)', '\1', 'g');
  -- Mention tokens @[Name](id) -> @Name
  out_text := regexp_replace(out_text, '@\[([^\]]+)\]\(([^)]+)\)', '@\1', 'g');
  out_text := regexp_replace(out_text, '\s+', ' ', 'g');
  out_text := btrim(out_text);
  IF length(out_text) > 140 THEN
    out_text := substring(out_text from 1 for 137) || '…';
  END IF;
  IF out_text = '' THEN
    RETURN CASE WHEN _has_image THEN '📷 Photo' ELSE '' END;
  END IF;
  IF _has_image THEN
    out_text := '📷 ' || out_text;
  END IF;
  RETURN out_text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.format_message_preview(text, boolean) TO authenticated, service_role;

-- Update direct-message trigger to push Messenger-style preview
CREATE OR REPLACE FUNCTION public.on_direct_message_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sender_name text;
  recipient_id uuid;
  conversation_record record;
  has_image boolean;
  notification_url text;
  notification_id uuid;
  push_body text;
  push_title text;
  collapse_tag text;
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
    INSERT INTO public.notifications (user_id, type, message, related_id, skip_push)
    VALUES (
      recipient_id,
      'direct_message',
      COALESCE(sender_name, 'Someone') || ' sent you a message',
      NEW.id,
      true
    )
    RETURNING id INTO notification_id;

    notification_url := '/messages/dm/' || NEW.conversation_id::text || '?message=' || NEW.id::text;
    push_title := COALESCE(sender_name, 'Someone');
    push_body := public.format_message_preview(NEW.text, has_image);
    IF push_body = '' THEN
      push_body := 'Sent you a message';
    END IF;
    collapse_tag := 'chat-dm-' || NEW.conversation_id::text;

    BEGIN
      SELECT net.http_post(
        url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/send-push-notification',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as'
        ),
        body := jsonb_build_object(
          'userId', recipient_id::text,
          'title', push_title,
          'body', push_body,
          'url', notification_url,
          'notificationId', notification_id::text,
          'tag', collapse_tag,
          'notificationType', 'direct_message',
          'data', jsonb_build_object(
            'notificationType', 'direct_message',
            'type', 'direct_message',
            'category', 'messages',
            'message_id', NEW.id::text,
            'related_id', NEW.id::text,
            'conversation_id', NEW.conversation_id::text,
            'author_id', NEW.author_id::text,
            'sender_name', COALESCE(sender_name, 'Someone'),
            'created_at', NEW.created_at::text,
            'text', NEW.text
          )
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
$$;
