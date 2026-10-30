CREATE OR REPLACE FUNCTION public.post_membership_system_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_team_id uuid;
  v_display_name text;
  v_role_label text;
  v_old_role_label text;
  v_text text;
  v_group record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_user_id := OLD.user_id;
    v_team_id := OLD.team_id;
    v_role_label := public.format_role_label(OLD.role);
  ELSE
    v_user_id := NEW.user_id;
    v_team_id := NEW.team_id;
    v_role_label := public.format_role_label(NEW.role);
  END IF;

  IF v_team_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Never announce club bot / broadcast accounts joining or leaving
  IF EXISTS (SELECT 1 FROM public.clubs WHERE bot_user_id = v_user_id) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_display_name := COALESCE(public.resolve_actor_display_name(v_user_id), 'A new member');

  IF TG_OP = 'INSERT' THEN
    v_text := v_display_name || ' joined as ' || v_role_label;
  ELSIF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = v_user_id AND team_id = v_team_id
    ) THEN
      v_text := v_display_name || ' is no longer a ' || v_role_label;
    ELSE
      v_text := v_display_name || ' left the team';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.role = OLD.role AND NEW.team_id IS NOT DISTINCT FROM OLD.team_id THEN
      RETURN NEW;
    END IF;
    v_old_role_label := public.format_role_label(OLD.role);
    v_text := v_display_name || ' is now a ' || v_role_label;
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  BEGIN
    INSERT INTO public.team_messages (team_id, author_id, text, is_system_message)
    VALUES (v_team_id, v_user_id, v_text, true);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to post team system message: %', SQLERRM;
  END;

  FOR v_group IN
    SELECT id, allowed_roles
    FROM public.chat_groups
    WHERE team_id = v_team_id
  LOOP
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
$function$;

-- Remove existing club-bot membership announcements
DELETE FROM public.team_messages tm
USING public.clubs c
WHERE tm.is_system_message = true
  AND tm.author_id = c.bot_user_id
  AND (tm.text LIKE '% joined as %' OR tm.text LIKE '% is now a %' OR tm.text LIKE '% is no longer a %' OR tm.text LIKE '% left the team');

DELETE FROM public.group_messages gm
USING public.clubs c
WHERE gm.is_system_message = true
  AND gm.author_id = c.bot_user_id
  AND (gm.text LIKE '% joined as %' OR gm.text LIKE '% is now a %' OR gm.text LIKE '% is no longer a %' OR gm.text LIKE '% left the team');

DELETE FROM public.club_messages cm
USING public.clubs c
WHERE cm.author_id = c.bot_user_id
  AND (cm.text LIKE '% joined as %' OR cm.text LIKE '% is now a %' OR cm.text LIKE '% is no longer a %' OR cm.text LIKE '% left the team');