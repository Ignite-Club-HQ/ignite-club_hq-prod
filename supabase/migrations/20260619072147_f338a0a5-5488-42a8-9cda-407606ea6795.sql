CREATE OR REPLACE FUNCTION public.skip_duplicate_rsvps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  existing_id uuid;
BEGIN
  -- user-only RSVP
  IF NEW.child_id IS NULL AND NEW.mini_league_player_id IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT id INTO existing_id FROM public.rsvps
    WHERE event_id = NEW.event_id AND user_id = NEW.user_id
      AND child_id IS NULL AND mini_league_player_id IS NULL
    LIMIT 1;
    IF existing_id IS NOT NULL THEN
      UPDATE public.rsvps
        SET status = NEW.status,
            source = COALESCE(NEW.source, source),
            updated_at = now()
        WHERE id = existing_id;
      RETURN NULL;
    END IF;
  END IF;

  -- child RSVP
  IF NEW.child_id IS NOT NULL THEN
    SELECT id INTO existing_id FROM public.rsvps
    WHERE event_id = NEW.event_id AND child_id = NEW.child_id
    LIMIT 1;
    IF existing_id IS NOT NULL THEN
      UPDATE public.rsvps
        SET status = NEW.status,
            source = COALESCE(NEW.source, source),
            updated_at = now()
        WHERE id = existing_id;
      RETURN NULL;
    END IF;
  END IF;

  -- mini-league player RSVP
  IF NEW.mini_league_player_id IS NOT NULL THEN
    SELECT id INTO existing_id FROM public.rsvps
    WHERE event_id = NEW.event_id AND mini_league_player_id = NEW.mini_league_player_id
    LIMIT 1;
    IF existing_id IS NOT NULL THEN
      UPDATE public.rsvps
        SET status = NEW.status,
            source = COALESCE(NEW.source, source),
            updated_at = now()
        WHERE id = existing_id;
      RETURN NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;