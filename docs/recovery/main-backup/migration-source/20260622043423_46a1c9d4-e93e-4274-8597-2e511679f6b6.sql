ALTER TABLE public.team_messages ADD COLUMN IF NOT EXISTS is_sponsor boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.on_team_message_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  request_id bigint;
BEGIN
  IF NEW.is_system_message THEN
    RETURN NEW;
  END IF;

  -- Sponsor messages never trigger notifications (in-app or push)
  IF NEW.is_sponsor THEN
    RETURN NEW;
  END IF;

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