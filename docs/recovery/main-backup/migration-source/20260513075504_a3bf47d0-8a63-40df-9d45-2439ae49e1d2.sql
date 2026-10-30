CREATE OR REPLACE FUNCTION public.get_teams_leaderboard(_club_id uuid, _window text, _limit integer)
 RETURNS TABLE(rank integer, team_id uuid, team_name text, points integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _start timestamptz;
BEGIN
  IF _window = 'week' THEN
    _start := date_trunc('week', now());
  ELSIF _window = 'month' THEN
    _start := date_trunc('month', now());
  ELSE
    _start := '1900-01-01'::timestamptz;
  END IF;

  RETURN QUERY
  WITH club_teams AS (
    SELECT t.id AS tid, t.name AS tname
    FROM public.teams t
    WHERE t.club_id = _club_id
  ),
  team_member_users AS (
    SELECT DISTINCT ct.tid, ur.user_id AS uid
    FROM club_teams ct
    JOIN public.user_roles ur ON ur.team_id = ct.tid
    WHERE ur.user_id IS NOT NULL
  ),
  team_member_children AS (
    SELECT DISTINCT ct.tid, cta.child_id
    FROM club_teams ct
    JOIN public.child_team_assignments cta ON cta.team_id = ct.tid
  ),
  roster AS (
    SELECT ct.tid,
      (SELECT COUNT(*) FROM team_member_users u WHERE u.tid = ct.tid)
      + (SELECT COUNT(*) FROM team_member_children c WHERE c.tid = ct.tid) AS roster_size
    FROM club_teams ct
  ),
  -- Chat engagement: real human team messages within window
  chat_engagement AS (
    SELECT ct.tid,
      COUNT(tm.id)::int AS msg_count
    FROM club_teams ct
    LEFT JOIN public.team_messages tm
      ON tm.team_id = ct.tid
     AND tm.deleted_at IS NULL
     AND COALESCE(tm.is_system_message, false) = false
     AND COALESCE(tm.is_club_announcement, false) = false
     AND tm.created_at >= _start
    GROUP BY ct.tid
  ),
  -- Past, non-cancelled events in window per team
  team_events AS (
    SELECT ct.tid, e.id AS eid
    FROM club_teams ct
    JOIN public.events e
      ON e.team_id = ct.tid
     AND COALESCE(e.is_cancelled, false) = false
     AND COALESCE(e.start_time, e.event_date) >= _start
     AND COALESCE(e.start_time, e.event_date) <= now()
  ),
  rsvp_counts AS (
    SELECT te.tid,
      COUNT(*) FILTER (WHERE r.status IS NOT NULL)::int AS responded,
      COUNT(DISTINCT te.eid)::int AS event_count
    FROM team_events te
    LEFT JOIN public.rsvps r ON r.event_id = te.eid
    GROUP BY te.tid
  ),
  scored AS (
    SELECT ct.tid, ct.tname,
      COALESCE(ce.msg_count, 0) AS chat_score,
      CASE
        WHEN COALESCE(rc.event_count, 0) = 0 OR COALESCE(r.roster_size, 0) = 0 THEN 0::numeric
        ELSE LEAST(
          1.0::numeric,
          rc.responded::numeric / GREATEST(rc.event_count * r.roster_size, 1)::numeric
        )
      END AS response_rate
    FROM club_teams ct
    LEFT JOIN chat_engagement ce ON ce.tid = ct.tid
    LEFT JOIN rsvp_counts rc ON rc.tid = ct.tid
    LEFT JOIN roster r ON r.tid = ct.tid
  ),
  totals AS (
    SELECT s.tid, s.tname,
      (s.chat_score + ROUND(s.response_rate * 500))::int AS pts
    FROM scored s
  ),
  ranked AS (
    SELECT t.tid, t.tname, t.pts,
      RANK() OVER (ORDER BY t.pts DESC) AS r
    FROM totals t
    WHERE t.pts > 0
  )
  SELECT r.r::int, r.tid, r.tname, r.pts
  FROM ranked r
  WHERE r.r <= _limit
  ORDER BY r.r ASC, r.tname ASC;
END;
$function$;