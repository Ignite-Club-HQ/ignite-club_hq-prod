-- Fix message reaction notification trigger: rename `related_id` variable to avoid
-- name collision with the notifications.related_id column inside the dedup EXISTS query.
-- The collision caused `related_id = on_message_reaction_created.related_id` to be
-- ambiguous in some plans, leading to the dedup branch skipping every insert.

CREATE OR REPLACE FUNCTION public.on_message_reaction_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_message_author_id uuid;
  v_reactor_name text;
  v_notif_message text;
  v_related_id uuid;
  v_notif_type text := 'message_reaction';
  v_emoji_display text;
  v_supabase_url text;
  v_anon_key text;
  v_push_url text;
  v_push_tag text;
BEGIN
  SELECT display_name INTO v_reactor_name FROM public.profiles WHERE id = NEW.user_id;

  v_emoji_display := CASE NEW.reaction_type
    WHEN 'like' THEN '❤️'
    WHEN 'fire' THEN '🔥'
    WHEN 'clap' THEN '👏'
    WHEN 'laugh' THEN '😂'
    WHEN 'wow' THEN '😮'
    WHEN 'sad' THEN '😢'
    WHEN 'thumbsup' THEN '👍'
    ELSE NEW.reaction_type
  END;

  IF NEW.team_message_id IS NOT NULL THEN
    SELECT author_id, team_id INTO v_message_author_id, v_related_id
    FROM public.team_messages WHERE id = NEW.team_message_id;
    v_push_url := '/messages/' || COALESCE(v_related_id::text, '');
  ELSIF NEW.club_message_id IS NOT NULL THEN
    SELECT author_id, club_id INTO v_message_author_id, v_related_id
    FROM public.club_messages WHERE id = NEW.club_message_id;
    v_push_url := '/messages/club/' || COALESCE(v_related_id::text, '');
  ELSIF NEW.group_message_id IS NOT NULL THEN
    SELECT author_id, group_id INTO v_message_author_id, v_related_id
    FROM public.group_messages WHERE id = NEW.group_message_id;
    v_push_url := '/messages/group/' || COALESCE(v_related_id::text, '');
  ELSIF NEW.direct_message_id IS NOT NULL THEN
    SELECT author_id, conversation_id INTO v_message_author_id, v_related_id
    FROM public.direct_messages WHERE id = NEW.direct_message_id;
    v_push_url := '/messages/dm/' || COALESCE(v_related_id::text, '');
  ELSIF NEW.broadcast_message_id IS NOT NULL THEN
    SELECT author_id INTO v_message_author_id
    FROM public.broadcast_messages WHERE id = NEW.broadcast_message_id;
    v_related_id := NEW.broadcast_message_id;
    v_push_url := '/messages/broadcast';
  ELSIF NEW.club_admin_message_id IS NOT NULL THEN
    SELECT author_id, conversation_id INTO v_message_author_id, v_related_id
    FROM public.club_admin_messages WHERE id = NEW.club_admin_message_id;
    v_push_url := '/messages/club-admin/' || COALESCE(v_related_id::text, '');
  END IF;

  IF v_message_author_id IS NULL OR v_message_author_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  v_notif_message := COALESCE(v_reactor_name, 'Someone') || ' reacted ' || v_emoji_display || ' to your message';
  v_push_tag := 'msg-reaction-' || NEW.id::text;

  -- 5-minute dedup: skip if same reactor already produced an identical notification recently
  IF EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = v_message_author_id
      AND n.type = 'message_reaction'
      AND n.message = v_notif_message
      AND n.related_id IS NOT DISTINCT FROM v_related_id
      AND n.created_at > now() - interval '5 minutes'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, type, message, related_id, skip_push)
  VALUES (v_message_author_id, v_notif_type, v_notif_message, v_related_id, true);

  v_supabase_url := 'https://yabcfiuntwqjwvschnji.supabase.co';
  v_anon_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as';

  PERFORM net.http_post(
    url := v_supabase_url || '/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_key
    ),
    body := jsonb_build_object(
      'userId', v_message_author_id::text,
      'title', COALESCE(v_reactor_name, 'Someone') || ' reacted ' || v_emoji_display,
      'body', v_notif_message,
      'url', COALESCE(v_push_url, '/messages'),
      'tag', v_push_tag,
      'notificationType', v_notif_type
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Message reaction notification failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;