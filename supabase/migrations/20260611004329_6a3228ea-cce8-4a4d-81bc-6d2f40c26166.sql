CREATE OR REPLACE FUNCTION public.search_invitable_profiles(_query text, _limit integer DEFAULT 8)
 RETURNS TABLE(id uuid, display_name text, avatar_url text, masked_email text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := auth.uid();
  caller_can_see_email boolean := false;
  q text;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _query IS NULL OR length(trim(_query)) < 2 THEN
    RETURN;
  END IF;

  q := trim(_query);

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = caller
      AND ur.role IN (
        'app_admin'::app_role,
        'club_admin'::app_role,
        'team_admin'::app_role,
        'coach'::app_role,
        'committee_member'::app_role,
        'league_admin'::app_role
      )
  ) INTO caller_can_see_email;

  RETURN QUERY
  SELECT
    p.id,
    p.display_name,
    p.avatar_url,
    CASE
      WHEN caller_can_see_email THEN public.mask_email(au.email)
      ELSE NULL
    END AS masked_email
  FROM public.profiles p
  LEFT JOIN auth.users au ON au.id = p.id
  WHERE p.display_name ILIKE '%' || q || '%'
     OR (caller_can_see_email AND au.email ILIKE '%' || q || '%')
  ORDER BY
    CASE WHEN p.display_name ILIKE q || '%' THEN 0 ELSE 1 END,
    p.display_name
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 8), 20));
END;
$function$;