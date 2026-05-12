
-- 1) Drop redundant duplicate trigger (mark_pending_invite_accepted is a strict subset of auto_accept_pending_invites_on_role)
DROP TRIGGER IF EXISTS mark_pending_invite_accepted_trigger ON public.user_roles;

-- 2) Optimize notify_admins_new_member: drop expensive LIKE-on-message dedupe, use indexable equality only
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
  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;

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
    ELSE role_label := NEW.role::text;
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
      -- Cheap dedupe: same admin+team+type within 60s, no LIKE scan
      IF EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.user_id = admin_record.user_id
          AND n.type = 'member_joined'
          AND n.related_id = NEW.team_id
          AND n.created_at > now() - interval '60 seconds'
        LIMIT 1
      ) THEN
        CONTINUE;
      END IF;

      INSERT INTO public.notifications (user_id, type, message, related_id)
      VALUES (admin_record.user_id, 'member_joined',
        member_name || ' has joined ' || context_name || ' as ' || role_label,
        NEW.team_id);
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
      ) THEN
        CONTINUE;
      END IF;

      INSERT INTO public.notifications (user_id, type, message, related_id)
      VALUES (admin_record.user_id, 'member_joined',
        member_name || ' has joined ' || context_name || ' as ' || role_label,
        NEW.club_id);
    END LOOP;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_admins_new_member failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;

-- 3) Optimize notify_new_member_upcoming_events: lower cap, single-row EXISTS via index, remove sync HTTP call (the edge function is invoked from the client right after join anyway)
CREATE OR REPLACE FUNCTION public.notify_new_member_upcoming_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  event_record RECORD;
  series_counts jsonb := '{}'::jsonb;
  series_key text;
  current_count integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;

  FOR event_record IN
    SELECT id, parent_event_id
    FROM public.events
    WHERE is_cancelled = false
      AND event_date >= CURRENT_DATE
      AND (
        (NEW.team_id IS NOT NULL AND team_id = NEW.team_id)
        OR (NEW.team_id IS NULL AND NEW.club_id IS NOT NULL AND club_id = NEW.club_id AND team_id IS NULL)
      )
    ORDER BY event_date ASC
    LIMIT 25
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = NEW.user_id
        AND n.type = 'event_invite'
        AND n.related_id = event_record.id
      LIMIT 1
    ) THEN
      CONTINUE;
    END IF;

    IF event_record.parent_event_id IS NOT NULL THEN
      series_key := event_record.parent_event_id::text;
      current_count := COALESCE((series_counts ->> series_key)::integer, 0);
      IF current_count >= 3 THEN CONTINUE; END IF;
      series_counts := jsonb_set(series_counts, ARRAY[series_key], to_jsonb(current_count + 1));
    END IF;

    INSERT INTO public.notifications (user_id, type, message, related_id, skip_push)
    VALUES (NEW.user_id, 'event_invite',
      'You''ve been invited to an upcoming event',
      event_record.id, true);
  END LOOP;

  -- NOTE: removed inline net.http_post — the client invokes notify-new-member-events
  -- after the join completes, which is faster and doesn't block the INSERT.

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_new_member_upcoming_events failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;

-- 4) Supporting indexes to make the dedupe EXISTS lookups index-only
CREATE INDEX IF NOT EXISTS idx_notifications_dedupe_member_joined
  ON public.notifications (user_id, type, related_id, created_at DESC)
  WHERE type = 'member_joined';

CREATE INDEX IF NOT EXISTS idx_notifications_dedupe_event_invite
  ON public.notifications (user_id, related_id)
  WHERE type = 'event_invite';
