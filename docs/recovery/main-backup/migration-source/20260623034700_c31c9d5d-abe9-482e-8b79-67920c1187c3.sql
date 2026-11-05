
-- 1) Update club_admin_message trigger to set club_id on notifications.
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
  notif_body text;
BEGIN
  SELECT display_name INTO sender_name FROM public.profiles WHERE id = NEW.author_id;
  has_image := NEW.image_url IS NOT NULL AND NEW.image_url != '';

  SELECT * INTO conv FROM public.club_admin_conversations WHERE id = NEW.conversation_id;
  IF conv IS NULL THEN RETURN NEW; END IF;

  SELECT name INTO club_name FROM public.clubs WHERE id = conv.club_id;
  notification_url := '/messages/club-admin/' || NEW.conversation_id::text || '?message=' || NEW.id::text;

  IF NEW.author_id = conv.member_user_id THEN
    FOR recipient_id IN
      SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
      WHERE ur.club_id = conv.club_id
        AND ur.role = 'club_admin'
        AND ur.user_id <> NEW.author_id
    LOOP
      IF EXISTS (
        SELECT 1 FROM public.chat_mute_preferences cmp
        WHERE cmp.user_id = recipient_id
          AND cmp.chat_id = NEW.conversation_id
          AND cmp.chat_type = 'club_admin'
          AND (cmp.muted_until IS NULL OR cmp.muted_until > now())
      ) THEN CONTINUE; END IF;

      notif_body := COALESCE(sender_name, 'A member') || ' sent a message to club admins';

      INSERT INTO public.notifications (user_id, type, message, related_id, club_id, skip_push)
      VALUES (recipient_id, 'club_admin_message', notif_body, NEW.conversation_id, conv.club_id, true)
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
    recipient_id := conv.member_user_id;

    IF EXISTS (
      SELECT 1 FROM public.chat_mute_preferences cmp
      WHERE cmp.user_id = recipient_id
        AND cmp.chat_id = NEW.conversation_id
        AND cmp.chat_type = 'club_admin'
        AND (cmp.muted_until IS NULL OR cmp.muted_until > now())
    ) THEN RETURN NEW; END IF;

    notif_body := COALESCE(sender_name, 'A club admin') || ' replied to your message';

    INSERT INTO public.notifications (user_id, type, message, related_id, club_id, skip_push)
    VALUES (recipient_id, 'club_admin_message', notif_body, NEW.conversation_id, conv.club_id, true)
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

-- 2) Backfill: club_admin_message notifications → club from conversation
UPDATE public.notifications n
SET club_id = c.club_id
FROM public.club_admin_conversations c
WHERE n.club_id IS NULL
  AND n.type = 'club_admin_message'
  AND n.related_id = c.id;

-- 3) Backfill: photo_prompt_reminder → event → team → club
UPDATE public.notifications n
SET club_id = t.club_id
FROM public.events e
JOIN public.teams t ON t.id = e.team_id
WHERE n.club_id IS NULL
  AND n.type = 'photo_prompt_reminder'
  AND n.related_id = e.id
  AND t.club_id IS NOT NULL;

-- 4) Backfill: message_reply / message_mention / message_reaction where related_id
--    points at a team/club/group message we can join.
UPDATE public.notifications n
SET club_id = tm.club_id
FROM (
  SELECT tmsg.id, tm.club_id
  FROM public.team_messages tmsg
  JOIN public.teams tm ON tm.id = tmsg.team_id
) tm
WHERE n.club_id IS NULL
  AND n.type IN ('message_reply','message_mention','message_reaction')
  AND n.related_id = tm.id
  AND tm.club_id IS NOT NULL;

UPDATE public.notifications n
SET club_id = cm.club_id
FROM public.club_messages cm
WHERE n.club_id IS NULL
  AND n.type IN ('message_reply','message_mention','message_reaction')
  AND n.related_id = cm.id;

UPDATE public.notifications n
SET club_id = cg.club_id
FROM public.group_messages gm
JOIN public.chat_groups cg ON cg.id = gm.group_id
WHERE n.club_id IS NULL
  AND n.type IN ('message_reply','message_mention','message_reaction')
  AND n.related_id = gm.id
  AND cg.club_id IS NOT NULL;
