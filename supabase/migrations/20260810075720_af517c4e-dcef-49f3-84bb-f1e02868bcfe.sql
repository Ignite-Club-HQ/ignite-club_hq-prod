CREATE OR REPLACE FUNCTION public.seed_active_club_theme_from_invite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_email text;
  v_club_id uuid;
BEGIN
  IF NEW.active_club_theme_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT lower(email) INTO v_email FROM auth.users WHERE id = NEW.id;

  SELECT COALESCE(pi.club_id, t.club_id)
    INTO v_club_id
  FROM public.pending_invites pi
  LEFT JOIN public.teams t ON t.id = pi.team_id
  WHERE (
      pi.invited_user_id = NEW.id
      OR (v_email IS NOT NULL AND pi.invited_email IS NOT NULL AND lower(pi.invited_email) = v_email)
    )
    AND pi.status IN ('pending', 'accepted')
    AND COALESCE(pi.club_id, t.club_id) IS NOT NULL
  ORDER BY (pi.status = 'pending') DESC, pi.created_at ASC
  LIMIT 1;

  IF v_club_id IS NOT NULL THEN
    NEW.active_club_theme_id := v_club_id;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS seed_active_club_theme_from_invite_trigger ON public.profiles;
CREATE TRIGGER seed_active_club_theme_from_invite_trigger
BEFORE INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.seed_active_club_theme_from_invite();