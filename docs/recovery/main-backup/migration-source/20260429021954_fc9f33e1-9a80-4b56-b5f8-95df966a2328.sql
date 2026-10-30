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

  INSERT INTO public.notifications (user_id, type, message, related_id)
  SELECT DISTINCT recipient.user_id,
         'join_request',
         COALESCE(requester_name, 'Someone') || ' requested to join ' || COALESCE(target_name, 'a club/team') || ' as ' || NEW.role::text,
         NEW.id
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

INSERT INTO public.notifications (user_id, type, message, related_id)
SELECT 'f51dd664-b0d5-4956-b2d5-cec9222ae3dc'::uuid,
       'join_request',
       COALESCE(p.display_name, 'Someone') || ' requested to join ' || COALESCE(t.name, 'a club/team') || ' as ' || rr.role::text,
       rr.id
FROM public.role_requests rr
JOIN public.teams t ON t.id = rr.team_id
LEFT JOIN public.profiles p ON p.id = rr.user_id
WHERE rr.id = 'e9b8b4a5-1934-4bdd-8829-7ec2329fb7df'::uuid
  AND rr.status = 'pending'
  AND NOT EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.user_id = 'f51dd664-b0d5-4956-b2d5-cec9222ae3dc'::uuid
      AND n.type = 'join_request'
      AND n.related_id = rr.id
  );