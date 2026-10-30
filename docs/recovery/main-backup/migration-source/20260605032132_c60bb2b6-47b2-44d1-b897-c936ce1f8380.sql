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
  is_bot boolean;
  v_club_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;

  SELECT EXISTS (SELECT 1 FROM public.clubs WHERE bot_user_id = NEW.user_id) INTO is_bot;
  IF is_bot THEN RETURN NEW; END IF;

  SELECT display_name INTO member_name FROM public.profiles WHERE id = NEW.user_id;
  member_name := COALESCE(member_name, 'A new member');

  CASE NEW.role::text
    WHEN 'player' THEN role_label := 'Player';
    WHEN 'parent' THEN role_label := 'Parent';
    WHEN 'coach' THEN role_label := 'Coach';
    WHEN 'team_admin' THEN role_label := 'Team Admin';
    WHEN 'club_admin' THEN role_label := 'Club Admin';
    WHEN 'competition_admin' THEN role_label := 'Competition Admin';
    WHEN 'league_admin' THEN role_label := 'League Admin';
    WHEN 'association_admin' THEN role_label := 'Association Admin';
    WHEN 'committee_member' THEN role_label := 'Committee Member';
    WHEN 'app_admin' THEN role_label := 'App Admin';
    ELSE role_label := initcap(replace(NEW.role::text, '_', ' '));
  END CASE;

  IF NEW.team_id IS NOT NULL THEN
    SELECT name, club_id INTO context_name, v_club_id FROM public.teams WHERE id = NEW.team_id;
    context_name := COALESCE(context_name, 'the team');

    FOR admin_record IN
      SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
      WHERE ur.user_id <> NEW.user_id
        AND (
          (ur.team_id = NEW.team_id AND ur.role IN ('team_admin','coach'))
          OR (ur.role = 'club_admin' AND ur.club_id = v_club_id)
        )
    LOOP
      IF EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.user_id = admin_record.user_id
          AND n.type = 'member_joined'
          AND n.related_id = NEW.team_id
          AND n.created_at > now() - interval '60 seconds'
        LIMIT 1
      ) THEN CONTINUE; END IF;

      INSERT INTO public.notifications (user_id, type, message, related_id, skip_push)
      VALUES (admin_record.user_id, 'member_joined',
        member_name || ' has joined ' || context_name || ' as ' || role_label,
        NEW.team_id, true);
    END LOOP;

  ELSIF NEW.club_id IS NOT NULL THEN
    SELECT name INTO context_name FROM public.clubs WHERE id = NEW.club_id;
    context_name := COALESCE(context_name, 'the club');

    FOR admin_record IN
      SELECT DISTINCT ur.user_id FROM public.user_roles ur
      WHERE ur.club_id = NEW.club_id AND ur.role = 'club_admin' AND ur.user_id <> NEW.user_id
    LOOP
      IF EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.user_id = admin_record.user_id
          AND n.type = 'member_joined'
          AND n.related_id = NEW.club_id
          AND n.created_at > now() - interval '60 seconds'
        LIMIT 1
      ) THEN CONTINUE; END IF;

      INSERT INTO public.notifications (user_id, type, message, related_id, skip_push)
      VALUES (admin_record.user_id, 'member_joined',
        member_name || ' has joined ' || context_name || ' as ' || role_label,
        NEW.club_id, true);
    END LOOP;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_admins_new_member failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;