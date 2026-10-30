
-- Create trigger function for message reaction notifications
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
  -- Don't notify yourself
  SELECT display_name INTO reactor_name FROM public.profiles WHERE id = NEW.user_id;

  -- Map reaction_type to emoji for display
  emoji_display := CASE NEW.reaction_type
    WHEN 'like' THEN '❤️'
    WHEN 'fire' THEN '🔥'
    WHEN 'clap' THEN '👏'
    WHEN 'laugh' THEN '😂'
    WHEN 'wow' THEN '😮'
    WHEN 'sad' THEN '😢'
    ELSE NEW.reaction_type
  END;

  -- Determine author based on which message type was reacted to
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

  -- Don't notify if we couldn't find the author or if reacting to own message
  IF message_author_id IS NULL OR message_author_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  notif_message := COALESCE(reactor_name, 'Someone') || ' reacted ' || emoji_display || ' to your message';
  push_tag := 'msg-reaction-' || NEW.id::text;

  -- Insert in-app notification with skip_push = true (we'll send push directly)
  INSERT INTO public.notifications (user_id, type, message, related_id, skip_push)
  VALUES (message_author_id, notif_type, notif_message, related_id, true)
  ON CONFLICT DO NOTHING;

  -- Send push notification directly
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

-- Create trigger (only on INSERT, not UPDATE)
DROP TRIGGER IF EXISTS on_message_reaction_created_trigger ON public.message_reactions;
CREATE TRIGGER on_message_reaction_created_trigger
  AFTER INSERT ON public.message_reactions
  FOR EACH ROW
  EXECUTE FUNCTION public.on_message_reaction_created();
