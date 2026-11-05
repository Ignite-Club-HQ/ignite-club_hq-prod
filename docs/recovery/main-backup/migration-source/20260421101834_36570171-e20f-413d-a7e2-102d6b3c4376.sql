-- 1. Add is_system_message flag to team_messages and group_messages
ALTER TABLE public.team_messages
  ADD COLUMN IF NOT EXISTS is_system_message boolean NOT NULL DEFAULT false;

ALTER TABLE public.group_messages
  ADD COLUMN IF NOT EXISTS is_system_message boolean NOT NULL DEFAULT false;

-- 2. Update notification triggers to skip system messages (no push for join/leave notices)
CREATE OR REPLACE FUNCTION public.on_team_message_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  request_id bigint;
BEGIN
  -- Skip notification fan-out for system messages (join/leave notices)
  IF NEW.is_system_message THEN
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

CREATE OR REPLACE FUNCTION public.on_group_message_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  request_id bigint;
BEGIN
  -- Skip notification fan-out for system messages
  IF NEW.is_system_message THEN
    RETURN NEW;
  END IF;

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

-- 3. Helper: human-friendly role label
CREATE OR REPLACE FUNCTION public.format_role_label(_role public.app_role)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _role::text
    WHEN 'team_admin' THEN 'Team Admin'
    WHEN 'club_admin' THEN 'Club Admin'
    WHEN 'coach' THEN 'Coach'
    WHEN 'parent' THEN 'Parent'
    WHEN 'player' THEN 'Player'
    WHEN 'committee' THEN 'Committee Member'
    WHEN 'league_admin' THEN 'League Admin'
    WHEN 'app_admin' THEN 'App Admin'
    ELSE INITCAP(REPLACE(_role::text, '_', ' '))
  END
$$;

-- 4. Membership system message poster
-- Posts to:
--  - team_messages when the role row is team-scoped (team_id IS NOT NULL)
--  - group_messages for every chat_group whose team_id matches the role's team_id
--    AND whose allowed_roles contains the affected role.
CREATE OR REPLACE FUNCTION public.post_membership_system_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_team_id uuid;
  v_display_name text;
  v_role_label text;
  v_old_role_label text;
  v_text text;
  v_group record;
  v_op text := TG_OP;
BEGIN
  -- Determine acting row
  IF TG_OP = 'DELETE' THEN
    v_user_id := OLD.user_id;
    v_team_id := OLD.team_id;
    v_role_label := public.format_role_label(OLD.role);
  ELSE
    v_user_id := NEW.user_id;
    v_team_id := NEW.team_id;
    v_role_label := public.format_role_label(NEW.role);
  END IF;

  -- Only act on team-scoped role rows (skip pure club/app-level roles)
  IF v_team_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Resolve display name (fall back to "Someone")
  SELECT COALESCE(NULLIF(TRIM(display_name), ''), 'Someone')
    INTO v_display_name
    FROM public.profiles
    WHERE id = v_user_id;
  v_display_name := COALESCE(v_display_name, 'Someone');

  -- Build message text per operation
  IF TG_OP = 'INSERT' THEN
    v_text := v_display_name || ' joined as ' || v_role_label;
  ELSIF TG_OP = 'DELETE' THEN
    -- Only post a "left" message if this was the user's LAST role on this team.
    -- (Avoids spam when a multi-role member loses one of several roles.)
    IF EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = v_user_id AND team_id = v_team_id
    ) THEN
      v_text := v_display_name || ' is no longer a ' || v_role_label;
    ELSE
      v_text := v_display_name || ' left the team';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Only on actual role change for the same team
    IF NEW.role = OLD.role AND NEW.team_id IS NOT DISTINCT FROM OLD.team_id THEN
      RETURN NEW;
    END IF;
    v_old_role_label := public.format_role_label(OLD.role);
    v_text := v_display_name || ' is now a ' || v_role_label;
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Post into team chat
  BEGIN
    INSERT INTO public.team_messages (team_id, author_id, text, is_system_message)
    VALUES (v_team_id, v_user_id, v_text, true);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to post team system message: %', SQLERRM;
  END;

  -- Post into linked group chats whose allowed_roles still include the affected role
  FOR v_group IN
    SELECT id, allowed_roles
    FROM public.chat_groups
    WHERE team_id = v_team_id
  LOOP
    -- For INSERT/UPDATE: only post if the user's new role is in allowed_roles
    -- For DELETE: post if the removed role was in allowed_roles
    IF (TG_OP = 'DELETE' AND OLD.role = ANY(v_group.allowed_roles))
       OR (TG_OP IN ('INSERT','UPDATE') AND NEW.role = ANY(v_group.allowed_roles))
    THEN
      BEGIN
        INSERT INTO public.group_messages (group_id, author_id, text, is_system_message)
        VALUES (v_group.id, v_user_id, v_text, true);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Failed to post group system message for group %: %', v_group.id, SQLERRM;
      END;
    END IF;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'post_membership_system_message failed: %', SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 5. Triggers (separate INSERT, UPDATE OF role, DELETE — keeps things efficient)
DROP TRIGGER IF EXISTS trg_post_membership_system_message_ins ON public.user_roles;
CREATE TRIGGER trg_post_membership_system_message_ins
  AFTER INSERT ON public.user_roles
  FOR EACH ROW
  WHEN (NEW.team_id IS NOT NULL)
  EXECUTE FUNCTION public.post_membership_system_message();

DROP TRIGGER IF EXISTS trg_post_membership_system_message_upd ON public.user_roles;
CREATE TRIGGER trg_post_membership_system_message_upd
  AFTER UPDATE OF role, team_id ON public.user_roles
  FOR EACH ROW
  WHEN (NEW.team_id IS NOT NULL AND (NEW.role IS DISTINCT FROM OLD.role OR NEW.team_id IS DISTINCT FROM OLD.team_id))
  EXECUTE FUNCTION public.post_membership_system_message();

DROP TRIGGER IF EXISTS trg_post_membership_system_message_del ON public.user_roles;
CREATE TRIGGER trg_post_membership_system_message_del
  AFTER DELETE ON public.user_roles
  FOR EACH ROW
  WHEN (OLD.team_id IS NOT NULL)
  EXECUTE FUNCTION public.post_membership_system_message();