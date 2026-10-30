
-- 1) Active users per day for a club (SECURITY DEFINER so club admins bypass per-user RLS on user_activity_logs)
CREATE OR REPLACE FUNCTION public.club_engagement_active_users(
  _club_id uuid,
  _start timestamptz,
  _end timestamptz
)
RETURNS TABLE(day date, user_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    has_role(auth.uid(), 'app_admin'::app_role)
    OR has_role(auth.uid(), 'club_admin'::app_role, _club_id, NULL)
    OR has_role(auth.uid(), 'committee_member'::app_role, _club_id, NULL)
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT DISTINCT (l.started_at AT TIME ZONE 'UTC')::date AS day, l.user_id
  FROM public.user_activity_logs l
  WHERE l.club_id = _club_id
    AND l.started_at >= _start
    AND l.started_at <= _end
    AND l.user_id IS NOT NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.club_engagement_active_users(uuid, timestamptz, timestamptz) TO authenticated;

-- 2) Per-day message volume (club + team aggregated) for a club
CREATE OR REPLACE FUNCTION public.club_engagement_message_volume(
  _club_id uuid,
  _start timestamptz,
  _end timestamptz
)
RETURNS TABLE(day date, club_count bigint, team_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    has_role(auth.uid(), 'app_admin'::app_role)
    OR has_role(auth.uid(), 'club_admin'::app_role, _club_id, NULL)
    OR has_role(auth.uid(), 'committee_member'::app_role, _club_id, NULL)
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  WITH c AS (
    SELECT (cm.created_at AT TIME ZONE 'UTC')::date AS day, COUNT(*)::bigint AS n
    FROM public.club_messages cm
    WHERE cm.club_id = _club_id
      AND cm.deleted_at IS NULL
      AND cm.created_at >= _start AND cm.created_at <= _end
    GROUP BY 1
  ),
  t AS (
    SELECT (tm.created_at AT TIME ZONE 'UTC')::date AS day, COUNT(*)::bigint AS n
    FROM public.team_messages tm
    JOIN public.teams te ON te.id = tm.team_id
    WHERE te.club_id = _club_id
      AND tm.deleted_at IS NULL
      AND tm.created_at >= _start AND tm.created_at <= _end
    GROUP BY 1
  ),
  d AS (
    SELECT generate_series(_start::date, _end::date, interval '1 day')::date AS day
  )
  SELECT d.day,
         COALESCE(c.n, 0) AS club_count,
         COALESCE(t.n, 0) AS team_count
  FROM d
  LEFT JOIN c USING (day)
  LEFT JOIN t USING (day)
  ORDER BY d.day;
END;
$$;

GRANT EXECUTE ON FUNCTION public.club_engagement_message_volume(uuid, timestamptz, timestamptz) TO authenticated;

-- 3) Totals (counts) for the dashboard cards
CREATE OR REPLACE FUNCTION public.club_engagement_totals(
  _club_id uuid,
  _start timestamptz,
  _end timestamptz
)
RETURNS TABLE(
  club_msgs bigint,
  team_msgs bigint,
  reactions bigint,
  broadcasts bigint,
  events bigint,
  rsvps_total bigint,
  rsvps_responded bigint,
  rsvps_going bigint,
  photos_uploaded bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    has_role(auth.uid(), 'app_admin'::app_role)
    OR has_role(auth.uid(), 'club_admin'::app_role, _club_id, NULL)
    OR has_role(auth.uid(), 'committee_member'::app_role, _club_id, NULL)
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*)::bigint FROM public.club_messages cm
       WHERE cm.club_id = _club_id AND cm.deleted_at IS NULL
         AND cm.created_at >= _start AND cm.created_at <= _end),
    (SELECT COUNT(*)::bigint FROM public.team_messages tm
       JOIN public.teams te ON te.id = tm.team_id
       WHERE te.club_id = _club_id AND tm.deleted_at IS NULL
         AND tm.created_at >= _start AND tm.created_at <= _end),
    (SELECT COUNT(*)::bigint FROM public.message_reactions mr
       LEFT JOIN public.club_messages cm ON cm.id = mr.club_message_id
       LEFT JOIN public.team_messages tm ON tm.id = mr.team_message_id
       LEFT JOIN public.teams te ON te.id = tm.team_id
       WHERE mr.created_at >= _start AND mr.created_at <= _end
         AND (cm.club_id = _club_id OR te.club_id = _club_id)),
    (SELECT COUNT(*)::bigint FROM public.broadcast_messages bm
       WHERE bm.club_id = _club_id
         AND bm.created_at >= _start AND bm.created_at <= _end),
    (SELECT COUNT(*)::bigint FROM public.events e
       JOIN public.teams te ON te.id = e.team_id
       WHERE te.club_id = _club_id
         AND e.is_cancelled = false
         AND e.type IN ('game','training')
         AND e.created_at >= _start AND e.created_at <= _end),
    (SELECT COUNT(*)::bigint FROM public.rsvps r
       JOIN public.events e ON e.id = r.event_id
       JOIN public.teams te ON te.id = e.team_id
       WHERE te.club_id = _club_id
         AND e.is_cancelled = false
         AND e.type IN ('game','training')
         AND e.created_at >= _start AND e.created_at <= _end),
    (SELECT COUNT(*)::bigint FROM public.rsvps r
       JOIN public.events e ON e.id = r.event_id
       JOIN public.teams te ON te.id = e.team_id
       WHERE te.club_id = _club_id
         AND e.is_cancelled = false
         AND e.type IN ('game','training')
         AND e.created_at >= _start AND e.created_at <= _end
         AND r.status IS NOT NULL AND r.status <> 'pending'),
    (SELECT COUNT(*)::bigint FROM public.rsvps r
       JOIN public.events e ON e.id = r.event_id
       JOIN public.teams te ON te.id = e.team_id
       WHERE te.club_id = _club_id
         AND e.is_cancelled = false
         AND e.type IN ('game','training')
         AND e.created_at >= _start AND e.created_at <= _end
         AND r.status = 'going'),
    (SELECT COUNT(*)::bigint FROM public.photos p
       WHERE p.club_id = _club_id AND p.deleted_at IS NULL
         AND p.created_at >= _start AND p.created_at <= _end);
END;
$$;

GRANT EXECUTE ON FUNCTION public.club_engagement_totals(uuid, timestamptz, timestamptz) TO authenticated;
