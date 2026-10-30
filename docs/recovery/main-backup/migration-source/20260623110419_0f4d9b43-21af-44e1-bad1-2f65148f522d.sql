
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
  SELECT display_name INTO requester_name
  FROM public.profiles
  WHERE id = NEW.user_id;

  IF NEW.team_id IS NOT NULL THEN
    SELECT t.name, t.club_id INTO target_name, target_club_id
    FROM public.teams t
    WHERE t.id = NEW.team_id;
  ELSIF NEW.club_id IS NOT NULL THEN
    SELECT c.name, c.id INTO target_name, target_club_id
    FROM public.clubs c
    WHERE c.id = NEW.club_id;
  END IF;

  IF NEW.role::text = 'parent' THEN
    child_name := NULLIF(NEW.metadata->>'child_name', '');
    IF child_name IS NULL AND NEW.metadata->>'child_id' IS NOT NULL THEN
      SELECT name INTO child_name
      FROM public.children
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
         COALESCE(requester_name, 'Someone') || ' requested to join ' || COALESCE(target_name, 'a club/team') || ' as ' || role_suffix,
         NEW.id,
         target_club_id
  FROM (
    SELECT ur.user_id
    FROM public.user_roles ur
    WHERE NEW.team_id IS NOT NULL
      AND ur.team_id = NEW.team_id
      AND ur.role IN ('team_admin', 'coach')

    UNION

    SELECT ur.user_id
    FROM public.user_roles ur
    WHERE target_club_id IS NOT NULL
      AND ur.club_id = target_club_id
      AND ur.role IN ('club_admin', 'league_admin', 'committee_member')

    UNION

    SELECT ur.user_id
    FROM public.user_roles ur
    WHERE ur.role = 'app_admin'
  ) recipient
  WHERE recipient.user_id != NEW.user_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.notifications existing
      WHERE existing.user_id = recipient.user_id
        AND existing.type = 'join_request'
        AND existing.related_id = NEW.id
    );

  RETURN NEW;
END;
$function$;

-- Backfill: set club_id on existing join_request notifications whose
-- related role_request can be resolved to a club.
UPDATE public.notifications n
SET club_id = COALESCE(t.club_id, rr.club_id)
FROM public.role_requests rr
LEFT JOIN public.teams t ON t.id = rr.team_id
WHERE n.type = 'join_request'
  AND n.club_id IS NULL
  AND n.related_id = rr.id
  AND COALESCE(t.club_id, rr.club_id) IS NOT NULL;
