-- 1. Shared, best-effort display-name resolver
CREATE OR REPLACE FUNCTION public.resolve_actor_display_name(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_name text;
  v_email text;
  v_meta jsonb;
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;

  SELECT NULLIF(TRIM(display_name), '') INTO v_name
  FROM public.profiles WHERE id = p_user_id;
  IF v_name IS NOT NULL THEN RETURN v_name; END IF;

  BEGIN
    SELECT u.email, u.raw_user_meta_data INTO v_email, v_meta
    FROM auth.users u WHERE u.id = p_user_id;
  EXCEPTION WHEN OTHERS THEN
    v_email := NULL; v_meta := NULL;
  END;

  IF v_meta IS NOT NULL THEN
    v_name := COALESCE(
      NULLIF(TRIM(v_meta->>'display_name'), ''),
      NULLIF(TRIM(v_meta->>'full_name'), ''),
      NULLIF(TRIM(v_meta->>'name'), ''),
      NULLIF(TRIM(CONCAT_WS(' ', v_meta->>'first_name', v_meta->>'last_name')), '')
    );
    IF v_name IS NOT NULL THEN RETURN v_name; END IF;
  END IF;

  -- Name supplied on the invite that brought them in
  SELECT NULLIF(TRIM(pi.invited_label), '') INTO v_name
  FROM public.pending_invites pi
  WHERE pi.invited_user_id = p_user_id
     OR (v_email IS NOT NULL AND LOWER(pi.invited_email) = LOWER(v_email))
  ORDER BY pi.accepted_at DESC NULLS LAST, pi.created_at DESC
  LIMIT 1;
  IF v_name IS NOT NULL THEN RETURN v_name; END IF;

  IF v_email IS NOT NULL AND POSITION('@' IN v_email) > 1 THEN
    RETURN INITCAP(REPLACE(REPLACE(SPLIT_PART(v_email, '@', 1), '.', ' '), '_', ' '));
  END IF;

  RETURN NULL;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_actor_display_name(uuid) TO authenticated, service_role;

-- 2. Use the resolver in the "new member joined" admin notification
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
  v_team_id uuid;
  v_team_name text;
BEGIN
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;

  SELECT EXISTS (SELECT 1 FROM public.clubs WHERE bot_user_id = NEW.user_id) INTO is_bot;
  IF is_bot THEN RETURN NEW; END IF;

  member_name := COALESCE(public.resolve_actor_display_name(NEW.user_id), 'A new member');

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
    IF NEW.role::text IN ('parent','player') THEN
      SELECT mlp.mini_league_id, ml.name
        INTO v_mini_league_id, v_mini_league_name
      FROM public.mini_league_players mlp
      JOIN public.mini_leagues ml ON ml.id = mlp.mini_league_id
      WHERE ml.club_id = NEW.club_id
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
      IF NEW.role::text IN ('parent','player') THEN
        SELECT t.id, t.name
          INTO v_team_id, v_team_name
        FROM public.child_team_assignments cta
        JOIN public.teams t ON t.id = cta.team_id
        WHERE t.club_id = NEW.club_id
          AND cta.child_id IN (
            SELECT cg.child_id FROM public.child_guardians cg WHERE cg.guardian_id = NEW.user_id
            UNION
            SELECT c.id FROM public.children c WHERE c.parent_id = NEW.user_id
          )
        ORDER BY cta.created_at DESC
        LIMIT 1;
      END IF;

      IF v_team_id IS NOT NULL THEN
        context_name := v_team_name;

        FOR admin_record IN
          SELECT DISTINCT ur.user_id
          FROM public.user_roles ur
          WHERE ur.user_id <> NEW.user_id
            AND (
              (ur.team_id = v_team_id AND ur.role IN ('team_admin','coach'))
              OR (ur.role = 'club_admin' AND ur.club_id = NEW.club_id)
            )
        LOOP
          IF EXISTS (
            SELECT 1 FROM public.notifications n
            WHERE n.user_id = admin_record.user_id
              AND n.type = 'member_joined'
              AND n.related_id = v_team_id
              AND n.created_at > now() - interval '60 seconds'
            LIMIT 1
          ) THEN CONTINUE; END IF;

          INSERT INTO public.notifications (user_id, type, message, related_id, skip_push)
          VALUES (admin_record.user_id, 'member_joined',
            member_name || ' has joined ' || context_name || ' as ' || role_label,
            v_team_id, true);
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
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_admins_new_member failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;

-- 3. Chat "joined as" system messages
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

-- 4. Join-request notifications
CREATE OR REPLACE FUNCTION public.on_role_request_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  requester_name text;
  target_name text;
  target_club_id uuid;
  child_name text;
  role_suffix text;
BEGIN
  requester_name := COALESCE(public.resolve_actor_display_name(NEW.user_id), 'A new member');

  IF NEW.team_id IS NOT NULL THEN
    SELECT t.name, t.club_id INTO target_name, target_club_id
    FROM public.teams t WHERE t.id = NEW.team_id;
  ELSIF NEW.club_id IS NOT NULL THEN
    SELECT c.name, c.id INTO target_name, target_club_id
    FROM public.clubs c WHERE c.id = NEW.club_id;
  END IF;

  IF NEW.role::text = 'parent' THEN
    child_name := NULLIF(NEW.metadata->>'child_name', '');
    IF child_name IS NULL AND NEW.metadata->>'child_id' IS NOT NULL THEN
      SELECT name INTO child_name FROM public.children
      WHERE id = (NEW.metadata->>'child_id')::uuid;
    END IF;
  END IF;

  IF child_name IS NOT NULL THEN
    role_suffix := NEW.role::text || ' of ' || child_name;
  ELSE
    role_suffix := NEW.role::text;
  END IF;

  INSERT INTO public.notifications (user_id, type, message, related_id, club_id)
  SELECT DISTINCT recipient.user_id,
         'join_request',
         requester_name || ' requested to join ' || COALESCE(target_name, 'a club/team') || ' as ' || role_suffix,
         NEW.id,
         target_club_id
  FROM (
    SELECT ur.user_id FROM public.user_roles ur
    WHERE NEW.team_id IS NOT NULL AND ur.team_id = NEW.team_id AND ur.role IN ('team_admin', 'coach')
    UNION
    SELECT ur.user_id FROM public.user_roles ur
    WHERE target_club_id IS NOT NULL AND ur.club_id = target_club_id
      AND ur.role IN ('club_admin', 'league_admin', 'committee_member')
    UNION
    SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'app_admin'
  ) recipient
  WHERE recipient.user_id != NEW.user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications existing
      WHERE existing.user_id = recipient.user_id
        AND existing.type = 'join_request'
        AND existing.related_id = NEW.id
    );

  RETURN NEW;
END;
$function$;

-- 5. Self-healing backfill: when a name lands later, repair recent placeholders
CREATE OR REPLACE FUNCTION public.repair_placeholder_member_names()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_name text;
  v_pattern text;
BEGIN
  v_name := NULLIF(TRIM(NEW.display_name), '');
  IF v_name IS NULL THEN RETURN NEW; END IF;
  IF NULLIF(TRIM(COALESCE(OLD.display_name, '')), '') IS NOT NULL THEN RETURN NEW; END IF;

  FOREACH v_pattern IN ARRAY ARRAY['Someone', 'A new member', 'A member'] LOOP
    UPDATE public.team_messages tm
       SET text = v_name || SUBSTRING(tm.text FROM LENGTH(v_pattern) + 1)
     WHERE tm.author_id = NEW.id
       AND tm.is_system_message
       AND tm.created_at > now() - interval '30 days'
       AND tm.text LIKE v_pattern || ' %';

    UPDATE public.group_messages gm
       SET text = v_name || SUBSTRING(gm.text FROM LENGTH(v_pattern) + 1)
     WHERE gm.author_id = NEW.id
       AND gm.is_system_message
       AND gm.created_at > now() - interval '30 days'
       AND gm.text LIKE v_pattern || ' %';

    UPDATE public.notifications n
       SET message = v_name || SUBSTRING(n.message FROM LENGTH(v_pattern) + 1)
     WHERE n.type = 'join_request'
       AND n.created_at > now() - interval '30 days'
       AND n.message LIKE v_pattern || ' requested to join %'
       AND EXISTS (
         SELECT 1 FROM public.role_requests rr
         WHERE rr.id = n.related_id AND rr.user_id = NEW.id
       );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'repair_placeholder_member_names failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_repair_placeholder_member_names ON public.profiles;
CREATE TRIGGER trg_repair_placeholder_member_names
AFTER UPDATE OF display_name ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.repair_placeholder_member_names();