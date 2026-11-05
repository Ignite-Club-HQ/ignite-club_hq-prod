CREATE OR REPLACE FUNCTION public.apply_training_defaults_on_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.type::text <> 'training' OR NEW.team_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.is_cancelled THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.team_training_pauses p
    WHERE p.team_id = NEW.team_id
      AND NEW.event_date >= p.starts_at
      AND NEW.event_date <  p.ends_at
  ) THEN RETURN NEW; END IF;

  -- Child-scoped defaults: attach a guardian user_id to satisfy
  -- rsvps_has_identifier_check. Skip children with no guardian.
  INSERT INTO public.rsvps (event_id, child_id, user_id, status, source)
  SELECT NEW.id, d.child_id, g.guardian_user_id, d.default_status::rsvp_status, 'default'
  FROM public.child_training_defaults d
  JOIN LATERAL (
    SELECT cg.guardian_user_id
    FROM public.child_guardians cg
    WHERE cg.child_id = d.child_id
    ORDER BY cg.created_at ASC NULLS LAST
    LIMIT 1
  ) g ON TRUE
  WHERE d.team_id = NEW.team_id
    AND d.child_id IS NOT NULL
    AND d.deleted_at IS NULL
    AND d.auto_paused_at IS NULL
    AND d.default_status = 'going'
    AND NOT EXISTS (
      SELECT 1 FROM public.rsvps r
      WHERE r.event_id = NEW.id AND r.child_id = d.child_id
    );

  -- Adult/user-scoped defaults unchanged.
  INSERT INTO public.rsvps (event_id, user_id, status, source)
  SELECT NEW.id, d.user_id, d.default_status::rsvp_status, 'default'
  FROM public.child_training_defaults d
  WHERE d.team_id = NEW.team_id
    AND d.user_id IS NOT NULL
    AND d.deleted_at IS NULL
    AND d.auto_paused_at IS NULL
    AND d.default_status = 'going'
    AND NOT EXISTS (
      SELECT 1 FROM public.rsvps r
      WHERE r.event_id = NEW.id AND r.user_id = d.user_id AND r.child_id IS NULL
    );

  RETURN NEW;
END;
$function$;