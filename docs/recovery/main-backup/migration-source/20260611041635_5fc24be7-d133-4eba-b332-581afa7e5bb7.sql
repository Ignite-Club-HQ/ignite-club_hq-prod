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
  v_mini_league_id uuid;
  v_mini_league_name text;
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
    -- Detect if this club-role was created as a side-effect of a mini-league join
    -- by looking for a recent mini_league_players row for this user (directly or via child_guardians)
    IF NEW.role::text IN ('parent','player') THEN
      SELECT mlp.mini_league_id, ml.name
        INTO v_mini_league_id, v_mini_league_name
      FROM public.mini_league_players mlp
      JOIN public.mini_leagues ml ON ml.id = mlp.mini_league_id
      WHERE ml.club_id = NEW.club_id
        AND mlp.created_at > now() - interval '5 minutes'
        AND (
          mlp.parent_user_id = NEW.user_id
          OR mlp.child_id IN (
            SELECT cg.child_id FROM public.child_guardians cg WHERE cg.guardian_id = NEW.user_id
            UNION
            SELECT c.id FROM public.children c WHERE c.parent_id = NEW.user_id
          )
        )
      ORDER BY mlp.created_at DESC
      LIMIT 1;
    END IF;

    IF v_mini_league_id IS NOT NULL THEN
      context_name := v_mini_league_name;

      -- Notify only this mini-league's admins + club admins of the owning club
      FOR admin_record IN
        SELECT DISTINCT user_id FROM (
          SELECT mla.user_id
          FROM public.mini_league_admins mla
          WHERE mla.mini_league_id = v_mini_league_id
          UNION
          SELECT ur.user_id
          FROM public.user_roles ur
          WHERE ur.club_id = NEW.club_id AND ur.role = 'club_admin'
        ) admins
        WHERE user_id <> NEW.user_id
      LOOP
        IF EXISTS (
          SELECT 1 FROM public.notifications n
          WHERE n.user_id = admin_record.user_id
            AND n.type = 'member_joined'
            AND n.related_id = v_mini_league_id
            AND n.created_at > now() - interval '60 seconds'
          LIMIT 1
        ) THEN CONTINUE; END IF;

        INSERT INTO public.notifications (user_id, type, message, related_id, skip_push)
        VALUES (admin_record.user_id, 'member_joined',
          member_name || ' has joined ' || context_name || ' as ' || role_label,
          v_mini_league_id, true);
      END LOOP;
    ELSE
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
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_admins_new_member failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;