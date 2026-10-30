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
  container_id uuid;
  message_id uuid;
  resolved_club_id uuid;
  parent_team_id uuid;
  parent_group_team_id uuid;
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
    SELECT author_id, team_id INTO message_author_id, container_id
    FROM public.team_messages WHERE id = NEW.team_message_id;
    message_id := NEW.team_message_id;
    parent_team_id := container_id;
    SELECT club_id INTO resolved_club_id FROM public.teams WHERE id = parent_team_id;
    push_url := '/messages/' || COALESCE(container_id::text, '') || '?message=' || message_id::text;
  ELSIF NEW.club_message_id IS NOT NULL THEN
    SELECT author_id, club_id INTO message_author_id, container_id
    FROM public.club_messages WHERE id = NEW.club_message_id;
    message_id := NEW.club_message_id;
    resolved_club_id := container_id;
    push_url := '/messages/club/' || COALESCE(container_id::text, '') || '?message=' || message_id::text;
  ELSIF NEW.group_message_id IS NOT NULL THEN
    SELECT author_id, group_id INTO message_author_id, container_id
    FROM public.group_messages WHERE id = NEW.group_message_id;
    message_id := NEW.group_message_id;
    SELECT club_id, team_id INTO resolved_club_id, parent_group_team_id
    FROM public.chat_groups WHERE id = container_id;
    IF resolved_club_id IS NULL AND parent_group_team_id IS NOT NULL THEN
      SELECT club_id INTO resolved_club_id FROM public.teams WHERE id = parent_group_team_id;
    END IF;
    push_url := '/groups/' || COALESCE(container_id::text, '') || '?message=' || message_id::text;
  ELSIF NEW.direct_message_id IS NOT NULL THEN
    SELECT author_id, conversation_id INTO message_author_id, container_id
    FROM public.direct_messages WHERE id = NEW.direct_message_id;
    message_id := NEW.direct_message_id;
    -- DMs are cross-club; leave resolved_club_id NULL
    push_url := '/messages/dm/' || COALESCE(container_id::text, '') || '?message=' || message_id::text;
  ELSIF NEW.broadcast_message_id IS NOT NULL THEN
    SELECT author_id INTO message_author_id
    FROM public.broadcast_messages WHERE id = NEW.broadcast_message_id;
    message_id := NEW.broadcast_message_id;
    push_url := '/messages/broadcast?message=' || message_id::text;
  END IF;

  IF message_author_id IS NULL OR message_author_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  notif_message := COALESCE(reactor_name, 'Someone') || ' reacted ' || emoji_display || ' to your message';
  push_tag := 'msg-reaction-' || NEW.id::text;

  INSERT INTO public.notifications (user_id, type, message, related_id, skip_push, club_id)
  VALUES (message_author_id, notif_type, notif_message, message_id, true, resolved_club_id)
  ON CONFLICT DO NOTHING;

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

-- Backfill: recent reaction notifications where club_id is NULL but the
-- parent message resolves to a club. DMs and broadcasts stay NULL.
UPDATE public.notifications n
SET club_id = sub.club_id
FROM (
  SELECT n2.id AS notif_id,
         COALESCE(
           cm.club_id,
           t.club_id,
           cg_club.club_id,
           cg_team_club.club_id
         ) AS club_id
  FROM public.notifications n2
  LEFT JOIN public.club_messages cm  ON cm.id  = n2.related_id
  LEFT JOIN public.team_messages tm  ON tm.id  = n2.related_id
  LEFT JOIN public.teams t           ON t.id   = tm.team_id
  LEFT JOIN public.group_messages gm ON gm.id  = n2.related_id
  LEFT JOIN public.chat_groups cg_club ON cg_club.id = gm.group_id
  LEFT JOIN public.teams cg_team_club  ON cg_team_club.id = cg_club.team_id
  WHERE n2.type = 'message_reaction'
    AND n2.club_id IS NULL
    AND n2.created_at > now() - interval '30 days'
) AS sub
WHERE n.id = sub.notif_id
  AND sub.club_id IS NOT NULL;