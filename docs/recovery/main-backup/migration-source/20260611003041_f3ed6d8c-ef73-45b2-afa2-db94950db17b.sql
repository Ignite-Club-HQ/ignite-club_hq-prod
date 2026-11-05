
CREATE OR REPLACE FUNCTION public.notify_new_mini_league_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_child_name text;
  v_child_parent_id uuid;
  v_league_name text;
  v_league_club_id uuid;
  v_actor uuid := auth.uid();
  guardian_record RECORD;
  event_record RECORD;
  series_counts jsonb := '{}'::jsonb;
  series_key text;
  current_count integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;

  SELECT name, parent_id INTO v_child_name, v_child_parent_id
  FROM public.children WHERE id = NEW.child_id;

  SELECT name, club_id INTO v_league_name, v_league_club_id
  FROM public.mini_leagues WHERE id = NEW.mini_league_id;

  v_child_name := COALESCE(v_child_name, 'Your child');
  v_league_name := COALESCE(v_league_name, 'the mini league');

  FOR guardian_record IN
    SELECT DISTINCT g_user_id FROM (
      SELECT v_child_parent_id AS g_user_id
      UNION
      SELECT guardian_id FROM public.child_guardians WHERE child_id = NEW.child_id
    ) g
    WHERE g.g_user_id IS NOT NULL
      AND (v_actor IS NULL OR g.g_user_id <> v_actor)
  LOOP
    -- Dedupe: skip if we already notified this guardian about this league in the last 5 min
    IF EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = guardian_record.g_user_id
        AND n.type = 'mini_league_added'
        AND n.related_id = NEW.mini_league_id
        AND n.created_at > now() - interval '5 minutes'
      LIMIT 1
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.notifications (user_id, type, message, related_id, club_id, skip_push)
    VALUES (
      guardian_record.g_user_id,
      'mini_league_added',
      v_child_name || ' has been added to ' || v_league_name,
      NEW.mini_league_id,
      v_league_club_id,
      false
    );

    -- Seed event_invite notifications for upcoming mini-league events (silent — no per-event push)
    series_counts := '{}'::jsonb;
    FOR event_record IN
      SELECT id, parent_event_id
      FROM public.events
      WHERE is_cancelled = false
        AND event_date >= CURRENT_DATE
        AND mini_league_id = NEW.mini_league_id
      ORDER BY event_date ASC
      LIMIT 25
    LOOP
      IF EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.user_id = guardian_record.g_user_id
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

      INSERT INTO public.notifications (user_id, type, message, related_id, club_id, skip_push)
      VALUES (
        guardian_record.g_user_id,
        'event_invite',
        'You''ve been invited to an upcoming event',
        event_record.id,
        v_league_club_id,
        true
      );
    END LOOP;
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_new_mini_league_assignment failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_new_mini_league_assignment ON public.child_mini_league_assignments;
CREATE TRIGGER trg_notify_new_mini_league_assignment
AFTER INSERT ON public.child_mini_league_assignments
FOR EACH ROW EXECUTE FUNCTION public.notify_new_mini_league_assignment();
