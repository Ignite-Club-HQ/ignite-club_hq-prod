
-- Notify team/club admins when a new member joins
CREATE OR REPLACE FUNCTION public.notify_admins_new_member()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  member_name text;
  context_name text;
  admin_record RECORD;
  role_label text;
BEGIN
  IF TG_OP != 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- Get the new member's display name
  SELECT display_name INTO member_name FROM public.profiles WHERE id = NEW.user_id;
  member_name := COALESCE(member_name, 'A new member');

  -- Map role to readable label
  CASE NEW.role::text
    WHEN 'player' THEN role_label := 'Player';
    WHEN 'parent' THEN role_label := 'Parent';
    WHEN 'coach' THEN role_label := 'Coach';
    WHEN 'team_admin' THEN role_label := 'Team Admin';
    WHEN 'club_admin' THEN role_label := 'Club Admin';
    ELSE role_label := NEW.role::text;
  END CASE;

  IF NEW.team_id IS NOT NULL THEN
    -- Team member joined: notify team_admin and coach roles for that team
    SELECT name INTO context_name FROM public.teams WHERE id = NEW.team_id;
    context_name := COALESCE(context_name, 'the team');

    FOR admin_record IN
      SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
      WHERE ur.team_id = NEW.team_id
        AND ur.role IN ('team_admin', 'coach')
        AND ur.user_id != NEW.user_id
    LOOP
      INSERT INTO public.notifications (user_id, type, message, related_id)
      VALUES (
        admin_record.user_id,
        'member_joined',
        member_name || ' has joined ' || context_name || ' as ' || role_label,
        NEW.team_id
      )
      ON CONFLICT DO NOTHING;
    END LOOP;

    -- Also notify club admins for the club this team belongs to
    FOR admin_record IN
      SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
      JOIN public.teams t ON t.club_id = ur.club_id
      WHERE t.id = NEW.team_id
        AND ur.role = 'club_admin'
        AND ur.user_id != NEW.user_id
    LOOP
      INSERT INTO public.notifications (user_id, type, message, related_id)
      VALUES (
        admin_record.user_id,
        'member_joined',
        member_name || ' has joined ' || context_name || ' as ' || role_label,
        NEW.team_id
      )
      ON CONFLICT DO NOTHING;
    END LOOP;

  ELSIF NEW.club_id IS NOT NULL AND NEW.team_id IS NULL THEN
    -- Club-level member joined: notify club admins
    SELECT name INTO context_name FROM public.clubs WHERE id = NEW.club_id;
    context_name := COALESCE(context_name, 'the club');

    FOR admin_record IN
      SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
      WHERE ur.club_id = NEW.club_id
        AND ur.role = 'club_admin'
        AND ur.user_id != NEW.user_id
    LOOP
      INSERT INTO public.notifications (user_id, type, message, related_id)
      VALUES (
        admin_record.user_id,
        'member_joined',
        member_name || ' has joined ' || context_name || ' as ' || role_label,
        NEW.club_id
      )
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_admins_new_member failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;

-- Create the trigger
DROP TRIGGER IF EXISTS on_new_member_notify_admins ON public.user_roles;
CREATE TRIGGER on_new_member_notify_admins
  AFTER INSERT ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_admins_new_member();
