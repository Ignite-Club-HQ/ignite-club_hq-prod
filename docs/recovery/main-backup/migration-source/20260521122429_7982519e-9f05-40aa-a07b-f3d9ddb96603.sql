CREATE OR REPLACE FUNCTION public.apply_training_default_forward()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_parent uuid;
BEGIN
  IF NEW.deleted_at IS NOT NULL
     OR NEW.auto_paused_at IS NOT NULL
     OR NEW.default_status <> 'going' THEN
    RETURN NEW;
  END IF;

  IF NEW.child_id IS NOT NULL THEN
    SELECT parent_id INTO v_parent FROM public.children WHERE id = NEW.child_id;
    IF v_parent IS NULL THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.rsvps (event_id, user_id, child_id, status, source)
    SELECT e.id, v_parent, NEW.child_id, 'going'::rsvp_status, 'default'
    FROM public.events e
    WHERE e.team_id = NEW.team_id
      AND e.type::text = 'training'
      AND e.is_cancelled = false
      AND e.event_date > now()
      AND NOT EXISTS (
        SELECT 1 FROM public.team_training_pauses p
        WHERE p.team_id = NEW.team_id
          AND e.event_date >= p.starts_at AND e.event_date < p.ends_at
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.rsvps r
        WHERE r.event_id = e.id AND r.child_id = NEW.child_id
      );
  ELSIF NEW.user_id IS NOT NULL THEN
    INSERT INTO public.rsvps (event_id, user_id, status, source)
    SELECT e.id, NEW.user_id, 'going'::rsvp_status, 'default'
    FROM public.events e
    WHERE e.team_id = NEW.team_id
      AND e.type::text = 'training'
      AND e.is_cancelled = false
      AND e.event_date > now()
      AND NOT EXISTS (
        SELECT 1 FROM public.team_training_pauses p
        WHERE p.team_id = NEW.team_id
          AND e.event_date >= p.starts_at AND e.event_date < p.ends_at
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.rsvps r
        WHERE r.event_id = e.id AND r.user_id = NEW.user_id AND r.child_id IS NULL
      );
  END IF;

  RETURN NEW;
END;
$function$;