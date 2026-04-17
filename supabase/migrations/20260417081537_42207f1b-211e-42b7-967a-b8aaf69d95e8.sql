CREATE OR REPLACE FUNCTION public.can_access_poll_chat(_chat_type poll_chat_type, _chat_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ok boolean := false;
BEGIN
  IF _user_id IS NULL THEN
    RETURN false;
  END IF;

  IF _chat_type = 'team' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = _user_id AND ur.team_id = _chat_id
    ) OR EXISTS (
      SELECT 1
      FROM public.teams t
      JOIN public.user_roles ur2 ON ur2.club_id = t.club_id AND ur2.user_id = _user_id
      WHERE t.id = _chat_id
        AND ur2.role IN ('club_admin','committee_member','app_admin')
    ) INTO v_ok;
    RETURN v_ok;

  ELSIF _chat_type = 'club' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = _user_id AND ur.club_id = _chat_id
    ) INTO v_ok;
    RETURN v_ok;

  ELSIF _chat_type = 'broadcast' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user_id
    ) INTO v_ok;
    RETURN v_ok;

  ELSIF _chat_type = 'group' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.chat_groups cg
      WHERE cg.id = _chat_id
        AND (
          (cg.team_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = _user_id
              AND ur.team_id = cg.team_id
              AND ur.role = ANY (cg.allowed_roles)
          ))
          OR (cg.club_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = _user_id
              AND ur.club_id = cg.club_id
              AND ur.role = ANY (cg.allowed_roles)
          ))
          OR cg.created_by = _user_id
        )
    ) INTO v_ok;
    RETURN v_ok;

  ELSIF _chat_type = 'club_admin' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.club_admin_conversations c
      WHERE c.id = _chat_id
        AND (
          c.member_user_id = _user_id
          OR EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = _user_id
              AND ur.club_id = c.club_id
              AND ur.role IN ('club_admin','committee_member','app_admin')
          )
        )
    ) INTO v_ok;
    RETURN v_ok;
  END IF;

  RETURN false;
END;
$function$;