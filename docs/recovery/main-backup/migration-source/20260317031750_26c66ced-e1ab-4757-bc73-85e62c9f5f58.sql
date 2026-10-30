-- Replace heavy synchronous notification triggers with lightweight async versions
-- that delegate fan-out to the process-message-notifications edge function

-- 1. Replace on_team_message_created
CREATE OR REPLACE FUNCTION public.on_team_message_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  request_id bigint;
BEGIN
  -- Delegate notification fan-out to async edge function
  SELECT net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/process-message-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as'
    ),
    body := jsonb_build_object(
      'messageType', 'team',
      'messageId', NEW.id,
      'authorId', NEW.author_id,
      'messageText', COALESCE(NEW.text, ''),
      'imageUrl', NEW.image_url,
      'teamId', NEW.team_id,
      'replyToId', NEW.reply_to_id
    )
  ) INTO request_id;
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Async notification dispatch failed for team message %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

-- 2. Replace on_club_message_created
CREATE OR REPLACE FUNCTION public.on_club_message_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  request_id bigint;
BEGIN
  SELECT net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/process-message-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as'
    ),
    body := jsonb_build_object(
      'messageType', 'club',
      'messageId', NEW.id,
      'authorId', NEW.author_id,
      'messageText', COALESCE(NEW.text, ''),
      'imageUrl', NEW.image_url,
      'clubId', NEW.club_id,
      'replyToId', NEW.reply_to_id
    )
  ) INTO request_id;
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Async notification dispatch failed for club message %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

-- 3. Replace on_group_message_created
CREATE OR REPLACE FUNCTION public.on_group_message_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  request_id bigint;
BEGIN
  SELECT net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/process-message-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as'
    ),
    body := jsonb_build_object(
      'messageType', 'group',
      'messageId', NEW.id,
      'authorId', NEW.author_id,
      'messageText', COALESCE(NEW.text, ''),
      'imageUrl', NEW.image_url,
      'groupId', NEW.group_id,
      'replyToId', NEW.reply_to_id
    )
  ) INTO request_id;
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Async notification dispatch failed for group message %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

-- 4. Replace on_broadcast_message_created (the most critical one)
CREATE OR REPLACE FUNCTION public.on_broadcast_message_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  request_id bigint;
BEGIN
  SELECT net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/process-message-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as'
    ),
    body := jsonb_build_object(
      'messageType', 'broadcast',
      'messageId', NEW.id,
      'authorId', NEW.author_id,
      'messageText', COALESCE(NEW.text, ''),
      'imageUrl', NEW.image_url,
      'replyToId', NEW.reply_to_id
    )
  ) INTO request_id;
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Async notification dispatch failed for broadcast message %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;