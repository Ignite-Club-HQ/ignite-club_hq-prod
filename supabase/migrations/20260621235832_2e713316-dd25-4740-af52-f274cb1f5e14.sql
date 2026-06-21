DROP FUNCTION IF EXISTS public.club_engagement_sponsor_performance(uuid,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone);

CREATE OR REPLACE FUNCTION public.club_engagement_sponsor_performance(_club_id uuid, _start timestamp with time zone, _end timestamp with time zone, _prev_start timestamp with time zone, _prev_end timestamp with time zone)
 RETURNS TABLE(sponsor_id uuid, sponsor_name text, unique_reach integer, views integer, clicks integer, ctr numeric, prev_clicks integer, prev_views integer, raw_views integer, raw_clicks integer, tracking_started timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _is_app_admin boolean;
  _is_club_admin boolean;
  _tracking_started timestamp with time zone;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id = _caller AND role = 'app_admin') INTO _is_app_admin;
  IF _club_id IS NULL THEN
    IF NOT _is_app_admin THEN RAISE EXCEPTION 'Forbidden'; END IF;
  ELSE
    SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id = _caller AND club_id = _club_id AND role IN ('club_admin','committee_member')) INTO _is_club_admin;
    IF NOT (_is_app_admin OR _is_club_admin) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  END IF;

  SELECT MIN(sa.created_at) INTO _tracking_started FROM sponsor_analytics sa WHERE sa.user_id IS NOT NULL;

  RETURN QUERY
  WITH club_sponsors AS (
    SELECT s.id, s.name FROM sponsors s
    WHERE s.is_active AND (_club_id IS NULL OR s.club_id = _club_id)
    LIMIT 500
  ),
  current_stats AS (
    SELECT sa.sponsor_id,
      COUNT(DISTINCT sa.user_id) AS reach,
      COUNT(*) FILTER (WHERE sa.event_type = 'view') AS v,
      COUNT(*) FILTER (WHERE sa.event_type = 'click') AS c
    FROM sponsor_analytics sa
    WHERE sa.created_at BETWEEN _start AND _end
      AND sa.user_id IS NOT NULL
      AND sa.sponsor_id IN (SELECT id FROM club_sponsors)
    GROUP BY sa.sponsor_id
  ),
  prev_stats AS (
    SELECT sa.sponsor_id,
      COUNT(*) FILTER (WHERE sa.event_type = 'view') AS pv,
      COUNT(*) FILTER (WHERE sa.event_type = 'click') AS pc
    FROM sponsor_analytics sa
    WHERE sa.created_at BETWEEN _prev_start AND _prev_end
      AND sa.user_id IS NOT NULL
      AND sa.sponsor_id IN (SELECT id FROM club_sponsors)
    GROUP BY sa.sponsor_id
  ),
  raw_stats AS (
    SELECT sa.sponsor_id,
      COUNT(*) FILTER (WHERE sa.event_type = 'view') AS rv,
      COUNT(*) FILTER (WHERE sa.event_type = 'click') AS rc
    FROM sponsor_analytics sa
    WHERE sa.created_at BETWEEN _start AND _end
      AND sa.sponsor_id IN (SELECT id FROM club_sponsors)
    GROUP BY sa.sponsor_id
  )
  SELECT
    cs.id, cs.name,
    COALESCE(curr.reach, 0)::int,
    COALESCE(curr.v, 0)::int,
    COALESCE(curr.c, 0)::int,
    CASE WHEN COALESCE(curr.v,0) > 0
         THEN ROUND((curr.c::numeric / curr.v::numeric) * 1000) / 10
         ELSE 0::numeric END,
    COALESCE(pr.pc, 0)::int,
    COALESCE(pr.pv, 0)::int,
    COALESCE(rs.rv, 0)::int,
    COALESCE(rs.rc, 0)::int,
    _tracking_started
  FROM club_sponsors cs
  LEFT JOIN current_stats curr ON curr.sponsor_id = cs.id
  LEFT JOIN prev_stats pr ON pr.sponsor_id = cs.id
  LEFT JOIN raw_stats rs ON rs.sponsor_id = cs.id
  ORDER BY COALESCE(curr.reach, 0) DESC, COALESCE(curr.c, 0) DESC, COALESCE(curr.v, 0) DESC;
END;
$function$;