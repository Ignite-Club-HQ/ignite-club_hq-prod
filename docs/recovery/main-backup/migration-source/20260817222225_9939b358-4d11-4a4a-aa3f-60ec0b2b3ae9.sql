DROP FUNCTION IF EXISTS public.search_invitable_profiles(text, integer);

CREATE OR REPLACE FUNCTION public.search_invitable_profiles(_query text, _limit integer DEFAULT 8, _club_id uuid DEFAULT NULL)
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
  WITH caller_app_admin AS (
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = caller AND ur.role = 'app_admin'::app_role
    ) AS is_app_admin
  ),
  caller_clubs AS (
    SELECT DISTINCT ur.club_id
    FROM public.user_roles ur
    WHERE ur.user_id = caller AND ur.club_id IS NOT NULL
      AND (_club_id IS NULL OR ur.club_id = _club_id)
    UNION
    SELECT DISTINCT t.club_id
    FROM public.user_roles ur
    JOIN public.teams t ON t.id = ur.team_id
    WHERE ur.user_id = caller AND ur.team_id IS NOT NULL AND t.club_id IS NOT NULL
      AND (_club_id IS NULL OR t.club_id = _club_id)
  ),
  caller_teams AS (
    SELECT DISTINCT ur.team_id
    FROM public.user_roles ur
    JOIN public.teams t ON t.id = ur.team_id
    WHERE ur.user_id = caller AND ur.team_id IS NOT NULL
      AND (_club_id IS NULL OR t.club_id = _club_id)
  ),
  caller_leagues AS (
    SELECT DISTINCT mla.mini_league_id
    FROM public.mini_league_admins mla
    JOIN public.mini_leagues ml ON ml.id = mla.mini_league_id
    WHERE mla.user_id = caller
      AND (_club_id IS NULL OR ml.club_id = _club_id)
  ),
  league_scope_profiles AS (
    SELECT DISTINCT mla.user_id
    FROM public.mini_league_admins mla
    WHERE mla.mini_league_id IN (SELECT mini_league_id FROM caller_leagues)
    UNION
    SELECT DISTINCT mlp.parent_user_id AS user_id
    FROM public.mini_league_players mlp
    WHERE mlp.parent_user_id IS NOT NULL
      AND mlp.mini_league_id IN (SELECT mini_league_id FROM caller_leagues)
  ),
  in_scope_profiles AS (
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE
      ur.user_id IS NOT NULL
      AND (
        (ur.club_id IS NOT NULL AND ur.club_id IN (SELECT club_id FROM caller_clubs))
        OR (ur.team_id IS NOT NULL AND ur.team_id IN (SELECT team_id FROM caller_teams))
        OR (
          ur.team_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.teams t
            WHERE t.id = ur.team_id
              AND t.club_id IN (SELECT club_id FROM caller_clubs)
          )
        )
      )
    UNION
    SELECT user_id FROM league_scope_profiles
  )
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
  WHERE
    (
      -- When a club scope is supplied, even app admins are restricted to that club
      (_club_id IS NULL AND (SELECT is_app_admin FROM caller_app_admin))
      OR p.id IN (SELECT user_id FROM in_scope_profiles)
      OR p.id = caller
    )
    AND (
      p.display_name ILIKE '%' || q || '%'
      OR (caller_can_see_email AND au.email ILIKE '%' || q || '%')
    )
  ORDER BY
    CASE WHEN p.display_name ILIKE q || '%' THEN 0 ELSE 1 END,
    p.display_name
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 8), 20));
END;
$function$;

REVOKE ALL ON FUNCTION public.search_invitable_profiles(text, integer, uuid) FROM public;
REVOKE ALL ON FUNCTION public.search_invitable_profiles(text, integer, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_invitable_profiles(text, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_invitable_profiles(text, integer, uuid) TO service_role;