-- Fix reaction notification trigger with dedup
CREATE OR REPLACE FUNCTION public.on_message_reaction_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  message_author_id uuid;
  reactor_name text;
  notif_message text;
  related_id uuid;
  notif_type text := 'message_reaction';
  emoji_display text;
  supabase_url text;
  anon_key text;
  push_url text;
  push_tag text;
BEGIN
  SELECT display_name INTO reactor_name FROM public.profiles WHERE id = NEW.user_id;

  emoji_display := CASE NEW.reaction_type
    WHEN 'like' THEN '❤️'
    WHEN 'fire' THEN '🔥'
    WHEN 'clap' THEN '👏'
    WHEN 'laugh' THEN '😂'
    WHEN 'wow' THEN '😮'
    WHEN 'sad' THEN '😢'
    ELSE NEW.reaction_type
  END;

  IF NEW.team_message_id IS NOT NULL THEN
    SELECT author_id, team_id INTO message_author_id, related_id
    FROM public.team_messages WHERE id = NEW.team_message_id;
    push_url := '/messages/' || COALESCE(related_id::text, '');
  ELSIF NEW.club_message_id IS NOT NULL THEN
    SELECT author_id, club_id INTO message_author_id, related_id
    FROM public.club_messages WHERE id = NEW.club_message_id;
    push_url := '/messages/club/' || COALESCE(related_id::text, '');
  ELSIF NEW.group_message_id IS NOT NULL THEN
    SELECT author_id, group_id INTO message_author_id, related_id
    FROM public.group_messages WHERE id = NEW.group_message_id;
    push_url := '/messages/group/' || COALESCE(related_id::text, '');
  ELSIF NEW.direct_message_id IS NOT NULL THEN
    SELECT author_id, conversation_id INTO message_author_id, related_id
    FROM public.direct_messages WHERE id = NEW.direct_message_id;
    push_url := '/messages/dm/' || COALESCE(related_id::text, '');
  ELSIF NEW.broadcast_message_id IS NOT NULL THEN
    SELECT author_id INTO message_author_id
    FROM public.broadcast_messages WHERE id = NEW.broadcast_message_id;
    related_id := NEW.broadcast_message_id;
    push_url := '/messages/broadcast';
  END IF;

  IF message_author_id IS NULL OR message_author_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  notif_message := COALESCE(reactor_name, 'Someone') || ' reacted ' || emoji_display || ' to your message';
  push_tag := 'msg-reaction-' || NEW.id::text;

  -- 5-minute dedup: skip if same user already sent same reaction notification recently
  IF EXISTS (
    SELECT 1 FROM public.notifications
    WHERE user_id = message_author_id
      AND type = 'message_reaction'
      AND message = notif_message
      AND related_id = on_message_reaction_created.related_id
      AND created_at > now() - interval '5 minutes'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, type, message, related_id, skip_push)
  VALUES (message_author_id, notif_type, notif_message, related_id, true);

  supabase_url := 'https://yabcfiuntwqjwvschnji.supabase.co';
  anon_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as';

  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key
    ),
    body := jsonb_build_object(
      'userId', message_author_id::text,
      'title', COALESCE(reactor_name, 'Someone') || ' reacted ' || emoji_display,
      'body', notif_message,
      'url', COALESCE(push_url, '/messages'),
      'tag', push_tag,
      'notificationType', notif_type
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Message reaction notification failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;

-- Clean up duplicate reaction notifications (keep only first per user+message+related_id)
DELETE FROM public.notifications
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      row_number() OVER (
        PARTITION BY user_id, type, message, related_id
        ORDER BY created_at ASC
      ) AS rn
    FROM public.notifications
    WHERE type = 'message_reaction'
  ) sub
  WHERE sub.rn > 1
);

-- Also clean up duplicate member_joined notifications  
DELETE FROM public.notifications
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      row_number() OVER (
        PARTITION BY user_id, type, message, related_id
        ORDER BY created_at ASC
      ) AS rn
    FROM public.notifications
    WHERE type = 'member_joined'
  ) sub
  WHERE sub.rn > 1
);