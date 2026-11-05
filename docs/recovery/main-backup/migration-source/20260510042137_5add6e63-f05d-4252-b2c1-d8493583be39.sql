
-- Auto-post events to team chat
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS auto_chat_post_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS chat_post_message_id uuid;

-- Trigger function: dispatch to edge function on event create / cancel
CREATE OR REPLACE FUNCTION public.on_event_auto_chat_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_action text;
  v_request_id bigint;
BEGIN
  -- Only matches & training
  IF NEW.type IS NULL OR NEW.type::text NOT IN ('match', 'training') THEN
    RETURN NEW;
  END IF;

  -- Skip recurring child instances; only the parent posts
  IF NEW.parent_event_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Must be tied to a team
  IF NEW.team_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF (TG_OP = 'INSERT') THEN
    IF COALESCE(NEW.is_cancelled, false) THEN
      RETURN NEW;
    END IF;
    v_action := 'event_created';
  ELSIF (TG_OP = 'UPDATE') THEN
    -- Only fire on transition to cancelled
    IF NEW.is_cancelled IS DISTINCT FROM OLD.is_cancelled
       AND COALESCE(NEW.is_cancelled, false) = true THEN
      v_action := 'event_cancelled';
    ELSE
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  SELECT net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/auto-post-event-to-chat',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as'
    ),
    body := jsonb_build_object(
      'action', v_action,
      'eventId', NEW.id::text
    )
  ) INTO v_request_id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'auto chat post dispatch failed for event %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_event_auto_chat_post_ins ON public.events;
CREATE TRIGGER trg_event_auto_chat_post_ins
AFTER INSERT ON public.events
FOR EACH ROW EXECUTE FUNCTION public.on_event_auto_chat_post();

DROP TRIGGER IF EXISTS trg_event_auto_chat_post_upd ON public.events;
CREATE TRIGGER trg_event_auto_chat_post_upd
AFTER UPDATE OF is_cancelled ON public.events
FOR EACH ROW EXECUTE FUNCTION public.on_event_auto_chat_post();
