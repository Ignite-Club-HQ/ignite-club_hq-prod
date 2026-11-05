
CREATE OR REPLACE FUNCTION public.get_club_leaderboard(_club_id uuid, _window text, _viewer_id uuid, _limit integer)
 RETURNS TABLE(rank integer, user_id uuid, display_name text, avatar_url text, points integer, is_viewer boolean, hidden boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _start timestamptz;
BEGIN
  IF _window = 'week' THEN _start := date_trunc('week', now());
  ELSIF _window = 'month' THEN _start := date_trunc('month', now());
  ELSE _start := '1900-01-01'::timestamptz;
  END IF;

  RETURN QUERY
  WITH club_users AS (
    SELECT DISTINCT ur.user_id AS uid FROM public.user_roles ur WHERE ur.club_id = _club_id AND ur.user_id IS NOT NULL
    UNION
    SELECT DISTINCT ur.user_id FROM public.user_roles ur JOIN public.teams t ON t.id = ur.team_id WHERE t.club_id = _club_id AND ur.user_id IS NOT NULL
    UNION
    SELECT DISTINCT c.parent_id FROM public.child_team_assignments cta JOIN public.teams t ON t.id = cta.team_id JOIN public.children c ON c.id = cta.child_id WHERE t.club_id = _club_id AND c.parent_id IS NOT NULL
    UNION
    SELECT DISTINCT cg.guardian_id FROM public.child_team_assignments cta JOIN public.teams t ON t.id = cta.team_id JOIN public.child_guardians cg ON cg.child_id = cta.child_id WHERE t.club_id = _club_id AND cg.guardian_id IS NOT NULL
  ),
  club_children AS (
    SELECT DISTINCT c.id AS cid, c.name AS child_name
    FROM public.child_team_assignments cta JOIN public.teams t ON t.id = cta.team_id JOIN public.children c ON c.id = cta.child_id
    WHERE t.club_id = _club_id
  ),
  user_rows AS (
    SELECT cu.uid AS uid, p.display_name AS display_name, p.avatar_url AS avatar_url, COALESCE(p.leaderboard_opt_out,false) AS opted_out,
      COALESCE((SELECT SUM(GREATEST(ph.amount,0))::int FROM public.points_history ph WHERE ph.club_id=_club_id AND ph.created_at>=_start AND ph.user_id=cu.uid),0) AS pts
    FROM club_users cu LEFT JOIN public.profiles p ON p.id = cu.uid
  ),
  child_rows AS (
    SELECT cc.cid AS uid,
      TRIM(COALESCE(cc.child_name,'')) AS display_name,
      NULL::text AS avatar_url,
      false AS opted_out,
      COALESCE((SELECT SUM(GREATEST(ph.amount,0))::int FROM public.points_history ph WHERE ph.club_id=_club_id AND ph.created_at>=_start AND ph.child_id=cc.cid),0) AS pts
    FROM club_children cc
  ),
  combined AS (
    SELECT * FROM user_rows UNION ALL SELECT * FROM child_rows
  ),
  visible AS (
    SELECT * FROM combined WHERE pts > 0 AND (NOT opted_out OR uid = _viewer_id)
  ),
  ranked AS (
    SELECT v.uid, v.display_name, v.avatar_url, v.pts, v.opted_out, RANK() OVER (ORDER BY v.pts DESC) AS r FROM visible v
  )
  SELECT r.r::int, r.uid, r.display_name, r.avatar_url, r.pts, (r.uid = _viewer_id), r.opted_out
  FROM ranked r WHERE r.r <= _limit OR r.uid = _viewer_id
  ORDER BY r.r ASC, r.display_name ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_team_leaderboard(_team_id uuid, _window text, _viewer_id uuid, _limit integer)
 RETURNS TABLE(rank integer, user_id uuid, display_name text, avatar_url text, points integer, is_viewer boolean, hidden boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _start timestamptz;
  _club_id uuid;
BEGIN
  SELECT t.club_id INTO _club_id FROM public.teams t WHERE t.id = _team_id;
  IF _window = 'week' THEN _start := date_trunc('week', now());
  ELSIF _window = 'month' THEN _start := date_trunc('month', now());
  ELSE _start := '1900-01-01'::timestamptz;
  END IF;

  RETURN QUERY
  WITH team_users AS (
    SELECT DISTINCT ur.user_id AS uid FROM public.user_roles ur WHERE ur.team_id = _team_id AND ur.user_id IS NOT NULL
    UNION
    SELECT DISTINCT c.parent_id FROM public.child_team_assignments cta JOIN public.children c ON c.id = cta.child_id WHERE cta.team_id = _team_id AND c.parent_id IS NOT NULL
    UNION
    SELECT DISTINCT cg.guardian_id FROM public.child_team_assignments cta JOIN public.child_guardians cg ON cg.child_id = cta.child_id WHERE cta.team_id = _team_id AND cg.guardian_id IS NOT NULL
  ),
  team_children AS (
    SELECT DISTINCT c.id AS cid, c.name AS child_name
    FROM public.child_team_assignments cta JOIN public.children c ON c.id = cta.child_id WHERE cta.team_id = _team_id
  ),
  user_rows AS (
    SELECT tu.uid AS uid, p.display_name AS display_name, p.avatar_url AS avatar_url, COALESCE(p.leaderboard_opt_out,false) AS opted_out,
      COALESCE((SELECT SUM(GREATEST(ph.amount,0))::int FROM public.points_history ph WHERE ph.club_id=_club_id AND ph.created_at>=_start AND ph.user_id=tu.uid),0) AS pts
    FROM team_users tu LEFT JOIN public.profiles p ON p.id = tu.uid
  ),
  child_rows AS (
    SELECT tc.cid AS uid,
      TRIM(COALESCE(tc.child_name,'')) AS display_name,
      NULL::text AS avatar_url,
      false AS opted_out,
      COALESCE((SELECT SUM(GREATEST(ph.amount,0))::int FROM public.points_history ph WHERE ph.club_id=_club_id AND ph.created_at>=_start AND ph.child_id=tc.cid),0) AS pts
    FROM team_children tc
  ),
  combined AS (SELECT * FROM user_rows UNION ALL SELECT * FROM child_rows),
  visible AS (SELECT * FROM combined WHERE pts > 0 AND (NOT opted_out OR uid = _viewer_id)),
  ranked AS (SELECT v.uid, v.display_name, v.avatar_url, v.pts, v.opted_out, RANK() OVER (ORDER BY v.pts DESC) AS r FROM visible v)
  SELECT r.r::int, r.uid, r.display_name, r.avatar_url, r.pts, (r.uid = _viewer_id), r.opted_out
  FROM ranked r WHERE r.r <= _limit OR r.uid = _viewer_id
  ORDER BY r.r ASC, r.display_name ASC;
END;
$function$;
