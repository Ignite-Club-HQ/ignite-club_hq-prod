-- Update the on_event_cancelled function to handle mini-league events
CREATE OR REPLACE FUNCTION public.on_event_cancelled()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  event_title text;
  member_user_id uuid;
BEGIN
  IF OLD.is_cancelled = false AND NEW.is_cancelled = true THEN
    event_title := NEW.title;
    
    -- Notify users who have RSVP'd
    INSERT INTO public.notifications (user_id, type, message, related_id)
    SELECT DISTINCT r.user_id, 'event_cancelled', 
      'Event cancelled: ' || COALESCE(event_title, 'An event') || ' has been cancelled', NEW.id
    FROM public.rsvps r
    WHERE r.event_id = NEW.id
      AND r.user_id IS NOT NULL;
    
    -- Handle mini-league events
    IF NEW.mini_league_id IS NOT NULL THEN
      -- Notify parents in the mini league
      FOR member_user_id IN 
        SELECT DISTINCT mlp.parent_user_id 
        FROM public.mini_league_players mlp
        WHERE mlp.mini_league_id = NEW.mini_league_id
          AND mlp.parent_user_id IS NOT NULL
          AND mlp.parent_user_id NOT IN (SELECT r.user_id FROM public.rsvps r WHERE r.event_id = NEW.id AND r.user_id IS NOT NULL)
      LOOP
        INSERT INTO public.notifications (user_id, type, message, related_id)
        VALUES (member_user_id, 'event_cancelled', 
          'Event cancelled: ' || COALESCE(event_title, 'An event') || ' has been cancelled', NEW.id)
        ON CONFLICT DO NOTHING;
      END LOOP;
      
      -- Notify league admins and coaches at club level
      FOR member_user_id IN 
        SELECT DISTINCT ur.user_id 
        FROM public.user_roles ur
        JOIN public.mini_leagues ml ON ml.club_id = ur.club_id
        WHERE ml.id = NEW.mini_league_id
          AND ur.role IN ('league_admin', 'coach', 'club_admin')
          AND ur.user_id NOT IN (SELECT r.user_id FROM public.rsvps r WHERE r.event_id = NEW.id AND r.user_id IS NOT NULL)
      LOOP
        INSERT INTO public.notifications (user_id, type, message, related_id)
        VALUES (member_user_id, 'event_cancelled', 
          'Event cancelled: ' || COALESCE(event_title, 'An event') || ' has been cancelled', NEW.id)
        ON CONFLICT DO NOTHING;
      END LOOP;
    ELSIF NEW.team_id IS NOT NULL THEN
      -- Team event - notify team members
      INSERT INTO public.notifications (user_id, type, message, related_id)
      SELECT DISTINCT ur.user_id, 'event_cancelled', 
        'Event cancelled: ' || COALESCE(event_title, 'An event') || ' has been cancelled', NEW.id
      FROM public.user_roles ur
      WHERE ur.team_id = NEW.team_id
        AND ur.user_id IS NOT NULL
        AND ur.user_id NOT IN (SELECT r.user_id FROM public.rsvps r WHERE r.event_id = NEW.id AND r.user_id IS NOT NULL);
    ELSE
      -- Club event - notify club members
      INSERT INTO public.notifications (user_id, type, message, related_id)
      SELECT DISTINCT ur.user_id, 'event_cancelled', 
        'Event cancelled: ' || COALESCE(event_title, 'An event') || ' has been cancelled', NEW.id
      FROM public.user_roles ur
      WHERE ur.club_id = NEW.club_id
        AND ur.user_id IS NOT NULL
        AND ur.user_id NOT IN (SELECT r.user_id FROM public.rsvps r WHERE r.event_id = NEW.id AND r.user_id IS NOT NULL);
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;