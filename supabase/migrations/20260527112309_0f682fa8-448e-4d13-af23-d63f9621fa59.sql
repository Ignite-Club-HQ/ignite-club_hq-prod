
CREATE OR REPLACE FUNCTION public.on_club_admin_message_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  sender_name text;
  conv record;
  club_name text;
  has_image boolean;
  notification_url text;
  notification_id uuid;
  request_id bigint;
  recipient_id uuid;
  notif_title text;
  notif_body text;
BEGIN
  SELECT display_name INTO sender_name FROM public.profiles WHERE id = NEW.author_id;
  has_image := NEW.image_url IS NOT NULL AND NEW.image_url != '';

  SELECT * INTO conv FROM public.club_admin_conversations WHERE id = NEW.conversation_id;
  IF conv IS NULL THEN RETURN NEW; END IF;

  SELECT name INTO club_name FROM public.clubs WHERE id = conv.club_id;
  notification_url := '/messages/club-admin/' || NEW.conversation_id::text || '?message=' || NEW.id::text;

  IF NEW.author_id = conv.member_user_id THEN
    -- Member -> notify all club admins for this club (except the author)
    FOR recipient_id IN
      SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
      WHERE ur.club_id = conv.club_id
        AND ur.role = 'club_admin'
        AND ur.user_id <> NEW.author_id
    LOOP
      -- Mute check
      IF EXISTS (
        SELECT 1 FROM public.chat_mute_preferences cmp
        WHERE cmp.user_id = recipient_id
          AND cmp.chat_id = NEW.conversation_id
          AND cmp.chat_type = 'club_admin'
          AND (cmp.muted_until IS NULL OR cmp.muted_until > now())
      ) THEN
        CONTINUE;
      END IF;

      notif_body := COALESCE(sender_name, 'A member') || ' sent a message to club admins';

      INSERT INTO public.notifications (user_id, type, message, related_id, skip_push)
      VALUES (recipient_id, 'club_admin_message', notif_body, NEW.conversation_id, true)
      RETURNING id INTO notification_id;

      BEGIN
        SELECT net.http_post(
          url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/send-push-notification',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as'
          ),
          body := jsonb_build_object(
            'userId', recipient_id,
            'title', COALESCE(club_name, 'Club') || ' — Member message',
            'body', notif_body,
            'url', notification_url,
            'notificationId', notification_id,
            'tag', 'club_admin_message-' || notification_id::text,
            'notificationType', 'club_admin_message'
          )
        ) INTO request_id;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Club admin message push failed for msg %: %', NEW.id, SQLERRM;
      END;
    END LOOP;
  ELSE
    -- Admin reply -> notify the member
    recipient_id := conv.member_user_id;

    IF EXISTS (
      SELECT 1 FROM public.chat_mute_preferences cmp
      WHERE cmp.user_id = recipient_id
        AND cmp.chat_id = NEW.conversation_id
        AND cmp.chat_type = 'club_admin'
        AND (cmp.muted_until IS NULL OR cmp.muted_until > now())
    ) THEN
      RETURN NEW;
    END IF;

    notif_body := COALESCE(sender_name, 'A club admin') || ' replied to your message';

    INSERT INTO public.notifications (user_id, type, message, related_id, skip_push)
    VALUES (recipient_id, 'club_admin_message', notif_body, NEW.conversation_id, true)
    RETURNING id INTO notification_id;

    BEGIN
      SELECT net.http_post(
        url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/send-push-notification',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as'
        ),
        body := jsonb_build_object(
          'userId', recipient_id,
          'title', COALESCE(club_name, 'Club') || ' — Admin reply',
          'body', notif_body,
          'url', notification_url,
          'notificationId', notification_id,
          'tag', 'club_admin_message-' || notification_id::text,
          'notificationType', 'club_admin_message'
        )
      ) INTO request_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Club admin reply push failed for msg %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_club_admin_message_created_trigger ON public.club_admin_messages;
CREATE TRIGGER on_club_admin_message_created_trigger
AFTER INSERT ON public.club_admin_messages
FOR EACH ROW
EXECUTE FUNCTION public.on_club_admin_message_created();
