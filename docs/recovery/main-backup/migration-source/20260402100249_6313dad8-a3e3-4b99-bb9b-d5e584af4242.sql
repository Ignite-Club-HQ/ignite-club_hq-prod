-- Step 1: Merge duplicate events
DO $$
DECLARE
  rec RECORD;
  canonical_id uuid;
  dup_id uuid;
  dup_ids uuid[];
BEGIN
  FOR rec IN
    SELECT title, team_id, event_date, 
           array_agg(id ORDER BY created_at ASC, id ASC) AS ids
    FROM public.events
    WHERE is_cancelled = false
    GROUP BY title, team_id, event_date
    HAVING count(*) > 1
  LOOP
    canonical_id := rec.ids[1];
    dup_ids := rec.ids[2:array_length(rec.ids, 1)];
    
    FOREACH dup_id IN ARRAY dup_ids LOOP
      -- Reparent RSVPs (skip if would cause duplicate)
      UPDATE public.rsvps SET event_id = canonical_id 
      WHERE event_id = dup_id 
        AND NOT EXISTS (
          SELECT 1 FROM public.rsvps r2 
          WHERE r2.event_id = canonical_id 
            AND r2.user_id = rsvps.user_id 
            AND COALESCE(r2.child_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(rsvps.child_id, '00000000-0000-0000-0000-000000000000'::uuid)
        );
      DELETE FROM public.rsvps WHERE event_id = dup_id;
      
      UPDATE public.duties SET event_id = canonical_id WHERE event_id = dup_id;
      
      UPDATE public.event_views SET event_id = canonical_id 
      WHERE event_id = dup_id 
        AND NOT EXISTS (
          SELECT 1 FROM public.event_views ev2 
          WHERE ev2.event_id = canonical_id AND ev2.user_id = event_views.user_id
        );
      DELETE FROM public.event_views WHERE event_id = dup_id;
      
      UPDATE public.event_guests SET event_id = canonical_id WHERE event_id = dup_id;
      UPDATE public.event_payments SET event_id = canonical_id WHERE event_id = dup_id;
      
      UPDATE public.event_sponsors SET event_id = canonical_id 
      WHERE event_id = dup_id
        AND NOT EXISTS (
          SELECT 1 FROM public.event_sponsors es2 
          WHERE es2.event_id = canonical_id AND es2.sponsor_id = event_sponsors.sponsor_id
        );
      DELETE FROM public.event_sponsors WHERE event_id = dup_id;
      
      UPDATE public.event_groups SET event_id = canonical_id WHERE event_id = dup_id;
      
      -- Notifications: related_id is uuid
      UPDATE public.notifications SET related_id = canonical_id
      WHERE related_id = dup_id;
      
      -- Reparent child events
      UPDATE public.events SET parent_event_id = canonical_id 
      WHERE parent_event_id = dup_id;
      
      DELETE FROM public.events WHERE id = dup_id;
    END LOOP;
  END LOOP;
END $$;

-- Step 2: Prevent future duplicate events
CREATE UNIQUE INDEX IF NOT EXISTS events_unique_occurrence_idx 
ON public.events (
  club_id, 
  COALESCE(team_id, '00000000-0000-0000-0000-000000000000'::uuid), 
  type, 
  lower(btrim(title)), 
  event_date
) WHERE is_cancelled = false;

-- Step 3: Update RSVP notification trigger with 60-second dedup
CREATE OR REPLACE FUNCTION public.on_rsvp_notify_admins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event RECORD;
  v_member_name text;
  v_child_name text;
  v_status text;
  v_message text;
  v_admin RECORD;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('going', 'maybe', 'not_going') THEN
    RETURN NEW;
  END IF;

  SELECT id, title, team_id, club_id, mini_league_id INTO v_event
  FROM public.events WHERE id = NEW.event_id;

  IF v_event IS NULL THEN RETURN NEW; END IF;

  SELECT display_name INTO v_member_name FROM public.profiles WHERE id = NEW.user_id;

  IF NEW.child_id IS NOT NULL THEN
    SELECT name INTO v_child_name FROM public.children WHERE id = NEW.child_id;
  END IF;

  v_status := CASE NEW.status
    WHEN 'going' THEN 'is going'
    WHEN 'maybe' THEN 'responded maybe'
    WHEN 'not_going' THEN 'can''t go'
  END;

  IF v_child_name IS NOT NULL THEN
    v_message := v_child_name || ' ' || v_status || ' to ' || COALESCE(v_event.title, 'an event');
  ELSE
    v_message := COALESCE(v_member_name, 'A member') || ' ' || v_status || ' to ' || COALESCE(v_event.title, 'an event');
  END IF;

  IF v_event.mini_league_id IS NOT NULL THEN
    FOR v_admin IN
      SELECT DISTINCT ur.user_id FROM public.user_roles ur
      JOIN public.mini_leagues ml ON ml.club_id = ur.club_id
      WHERE ml.id = v_event.mini_league_id AND ur.role = 'league_admin' AND ur.user_id != NEW.user_id
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.notifications
        WHERE user_id = v_admin.user_id AND type IN ('rsvp_updated','rsvp_update')
          AND message = v_message AND created_at > now() - interval '60 seconds'
      ) THEN
        INSERT INTO public.notifications (user_id, type, message, related_id)
        VALUES (v_admin.user_id, 'rsvp_updated', v_message, v_event.id);
      END IF;
    END LOOP;
  ELSIF v_event.team_id IS NOT NULL THEN
    FOR v_admin IN
      SELECT DISTINCT user_id FROM public.user_roles
      WHERE team_id = v_event.team_id AND role IN ('team_admin','coach') AND user_id != NEW.user_id
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.notifications
        WHERE user_id = v_admin.user_id AND type IN ('rsvp_updated','rsvp_update')
          AND message = v_message AND created_at > now() - interval '60 seconds'
      ) THEN
        INSERT INTO public.notifications (user_id, type, message, related_id)
        VALUES (v_admin.user_id, 'rsvp_updated', v_message, v_event.id);
      END IF;
    END LOOP;
  ELSE
    FOR v_admin IN
      SELECT DISTINCT user_id FROM public.user_roles
      WHERE club_id = v_event.club_id AND role IN ('club_admin') AND user_id != NEW.user_id
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.notifications
        WHERE user_id = v_admin.user_id AND type IN ('rsvp_updated','rsvp_update')
          AND message = v_message AND created_at > now() - interval '60 seconds'
      ) THEN
        INSERT INTO public.notifications (user_id, type, message, related_id)
        VALUES (v_admin.user_id, 'rsvp_updated', v_message, v_event.id);
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

-- Step 4: Clean up duplicate notifications from last 7 days
DELETE FROM public.notifications
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      row_number() OVER (
        PARTITION BY user_id, type, message, related_id
        ORDER BY created_at ASC
      ) AS rn
    FROM public.notifications
    WHERE created_at > now() - interval '7 days'
      AND type IN ('rsvp_updated', 'rsvp_update', 'event_invite', 'early_rsvp_points')
  ) sub
  WHERE sub.rn > 1
);