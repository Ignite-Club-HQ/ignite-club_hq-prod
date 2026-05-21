-- Treat anyone listed in child_guardians as a parent for permission checks
CREATE OR REPLACE FUNCTION public.is_parent_of_child(_user_id uuid, _child_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.children
    WHERE id = _child_id AND parent_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.child_guardians
    WHERE child_id = _child_id AND guardian_id = _user_id
  )
$function$;

-- Use the guardian who enabled the default as the rsvp owner, falling back to
-- children.parent_id if created_by is unset (legacy rows).
CREATE OR REPLACE FUNCTION public.apply_training_default_forward()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
BEGIN
  IF NEW.deleted_at IS NOT NULL
     OR NEW.auto_paused_at IS NOT NULL
     OR NEW.default_status <> 'going' THEN
    RETURN NEW;
  END IF;

  IF NEW.child_id IS NOT NULL THEN
    v_owner := COALESCE(NEW.created_by, (SELECT parent_id FROM public.children WHERE id = NEW.child_id));
    IF v_owner IS NULL THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.rsvps (event_id, user_id, child_id, status, source)
    SELECT e.id, v_owner, NEW.child_id, 'going'::rsvp_status, 'default'
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