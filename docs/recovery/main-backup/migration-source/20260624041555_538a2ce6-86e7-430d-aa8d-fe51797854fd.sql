-- 1) Scope the name search to profiles the caller actually has a relationship with.
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

  -- Caller's clubs (direct + via team) and teams + mini-leagues.
  -- App admins bypass the scope filter (they legitimately search across the platform).
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
    UNION
    SELECT DISTINCT t.club_id
    FROM public.user_roles ur
    JOIN public.teams t ON t.id = ur.team_id
    WHERE ur.user_id = caller AND ur.team_id IS NOT NULL AND t.club_id IS NOT NULL
  ),
  caller_teams AS (
    SELECT DISTINCT ur.team_id
    FROM public.user_roles ur
    WHERE ur.user_id = caller AND ur.team_id IS NOT NULL
  ),
  caller_leagues AS (
    SELECT DISTINCT ur.mini_league_id
    FROM public.user_roles ur
    WHERE ur.user_id = caller AND ur.mini_league_id IS NOT NULL
  ),
  in_scope_profiles AS (
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE
      ur.user_id IS NOT NULL
      AND (
        (ur.club_id IS NOT NULL AND ur.club_id IN (SELECT club_id FROM caller_clubs))
        OR (ur.team_id IS NOT NULL AND ur.team_id IN (SELECT team_id FROM caller_teams))
        OR (ur.mini_league_id IS NOT NULL AND ur.mini_league_id IN (SELECT mini_league_id FROM caller_leagues))
        OR (
          ur.team_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.teams t
            WHERE t.id = ur.team_id
              AND t.club_id IN (SELECT club_id FROM caller_clubs)
          )
        )
      )
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
      (SELECT is_app_admin FROM caller_app_admin)
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

REVOKE ALL ON FUNCTION public.search_invitable_profiles(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_invitable_profiles(text, integer) TO authenticated;


-- 2) Scoped email lookup so the invite flow can dedupe against existing users
--    the caller is allowed to see. Outside that scope it returns no row,
--    so it cannot be used to probe whether an arbitrary email has an account.
CREATE OR REPLACE FUNCTION public.lookup_invitable_user_by_email(
  _email text,
  _club_id uuid DEFAULT NULL,
  _team_id uuid DEFAULT NULL,
  _mini_league_id uuid DEFAULT NULL
)
 RETURNS TABLE(
   user_id uuid,
   display_name text,
   avatar_url text,
   already_in_club boolean,
   already_in_team boolean,
   already_in_mini_league boolean
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := auth.uid();
  e text;
  matched_user uuid;
  is_app_admin boolean := false;
  caller_club_ids uuid[];
  caller_team_ids uuid[];
  caller_league_ids uuid[];
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _email IS NULL OR position('@' IN _email) = 0 THEN
    RETURN;
  END IF;

  e := lower(trim(_email));

  SELECT au.id INTO matched_user
  FROM auth.users au
  WHERE lower(au.email) = e
  LIMIT 1;

  IF matched_user IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = caller AND ur.role = 'app_admin'::app_role
  ) INTO is_app_admin;

  SELECT
    array_agg(DISTINCT ur.club_id) FILTER (WHERE ur.club_id IS NOT NULL),
    array_agg(DISTINCT ur.team_id) FILTER (WHERE ur.team_id IS NOT NULL),
    array_agg(DISTINCT ur.mini_league_id) FILTER (WHERE ur.mini_league_id IS NOT NULL)
  INTO caller_club_ids, caller_team_ids, caller_league_ids
  FROM public.user_roles ur
  WHERE ur.user_id = caller;

  -- Expand caller's clubs to include clubs reachable via their teams.
  caller_club_ids := COALESCE(caller_club_ids, ARRAY[]::uuid[]);
  caller_team_ids := COALESCE(caller_team_ids, ARRAY[]::uuid[]);
  caller_league_ids := COALESCE(caller_league_ids, ARRAY[]::uuid[]);

  IF array_length(caller_team_ids, 1) > 0 THEN
    SELECT array_cat(caller_club_ids, COALESCE(array_agg(DISTINCT t.club_id) FILTER (WHERE t.club_id IS NOT NULL), ARRAY[]::uuid[]))
    INTO caller_club_ids
    FROM public.teams t
    WHERE t.id = ANY(caller_team_ids);
  END IF;

  -- Privacy gate: only disclose the match if the matched user shares a
  -- club / team / mini-league with the caller, OR the caller is app_admin.
  IF NOT is_app_admin AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles tur
    WHERE tur.user_id = matched_user
      AND (
        (tur.club_id IS NOT NULL AND tur.club_id = ANY(caller_club_ids))
        OR (tur.team_id IS NOT NULL AND tur.team_id = ANY(caller_team_ids))
        OR (tur.mini_league_id IS NOT NULL AND tur.mini_league_id = ANY(caller_league_ids))
        OR (
          tur.team_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.teams t2
            WHERE t2.id = tur.team_id AND t2.club_id = ANY(caller_club_ids)
          )
        )
      )
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id AS user_id,
    p.display_name,
    p.avatar_url,
    CASE
      WHEN _club_id IS NULL THEN false
      ELSE EXISTS (
        SELECT 1 FROM public.user_roles ur2
        WHERE ur2.user_id = matched_user AND ur2.club_id = _club_id
      )
    END AS already_in_club,
    CASE
      WHEN _team_id IS NULL THEN false
      ELSE EXISTS (
        SELECT 1 FROM public.user_roles ur3
        WHERE ur3.user_id = matched_user AND ur3.team_id = _team_id
      )
    END AS already_in_team,
    CASE
      WHEN _mini_league_id IS NULL THEN false
      ELSE EXISTS (
        SELECT 1 FROM public.user_roles ur4
        WHERE ur4.user_id = matched_user AND ur4.mini_league_id = _mini_league_id
      )
    END AS already_in_mini_league
  FROM public.profiles p
  WHERE p.id = matched_user;
END;
$function$;

REVOKE ALL ON FUNCTION public.lookup_invitable_user_by_email(text, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_invitable_user_by_email(text, uuid, uuid, uuid) TO authenticated;