CREATE OR REPLACE FUNCTION public.club_engagement_rsvp_completion_series(_club_id uuid, _start timestamptz, _end timestamptz)
 RETURNS TABLE(day date, completion_pct numeric, responded bigint, expected bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _club_id IS NULL THEN
    IF NOT has_role(auth.uid(), 'app_admin'::app_role) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;

    RETURN QUERY
    WITH ev AS (
      SELECT e.id, e.team_id, (e.start_time AT TIME ZONE 'UTC')::date AS d
      FROM public.events e
      WHERE COALESCE(e.is_cancelled, false) = false
        AND e.type IN ('game','training')
        AND e.start_time >= _start AND e.start_time <= _end
    ),
    expected_per_day AS (
      SELECT ev.d, SUM(
        COALESCE((SELECT COUNT(*) FROM public.child_team_assignments cta WHERE cta.team_id = ev.team_id), 0)
      + COALESCE((SELECT COUNT(*) FROM public.user_roles ur WHERE ur.team_id = ev.team_id AND ur.role = 'player'::app_role), 0)
      )::bigint AS expected
      FROM ev GROUP BY ev.d
    ),
    responded_per_day AS (
      SELECT ev.d, COUNT(*)::bigint AS responded
      FROM public.rsvps r JOIN ev ON ev.id = r.event_id
      WHERE r.status IS NOT NULL
        AND ((r.child_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.child_team_assignments cta WHERE cta.team_id = ev.team_id AND cta.child_id = r.child_id))
          OR (r.child_id IS NULL AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.team_id = ev.team_id AND ur.user_id = r.user_id AND ur.role = 'player'::app_role)))
      GROUP BY ev.d
    ),
    dd AS (SELECT generate_series((_start AT TIME ZONE 'UTC')::date, (_end AT TIME ZONE 'UTC')::date, interval '1 day')::date AS d)
    SELECT dd.d,
           CASE WHEN COALESCE(e.expected,0) > 0
                THEN ROUND((COALESCE(r.responded,0)::numeric / e.expected::numeric) * 100, 1)
                ELSE NULL END,
           COALESCE(r.responded, 0),
           COALESCE(e.expected, 0)
    FROM dd
    LEFT JOIN expected_per_day e ON e.d = dd.d
    LEFT JOIN responded_per_day r ON r.d = dd.d
    ORDER BY dd.d;
    RETURN;
  END IF;

  IF NOT (
    has_role(auth.uid(), 'app_admin'::app_role)
    OR has_role(auth.uid(), 'club_admin'::app_role, _club_id, NULL)
    OR has_role(auth.uid(), 'committee_member'::app_role, _club_id, NULL)
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  WITH ev AS (
    SELECT e.id, e.team_id, (e.start_time AT TIME ZONE 'UTC')::date AS d
    FROM public.events e
    LEFT JOIN public.teams te ON te.id = e.team_id
    WHERE COALESCE(e.is_cancelled, false) = false
      AND e.type IN ('game','training')
      AND e.start_time >= _start AND e.start_time <= _end
      AND (e.club_id = _club_id OR te.club_id = _club_id)
  ),
  expected_per_day AS (
    SELECT ev.d, SUM(
      COALESCE((SELECT COUNT(*) FROM public.child_team_assignments cta WHERE cta.team_id = ev.team_id), 0)
    + COALESCE((SELECT COUNT(*) FROM public.user_roles ur WHERE ur.team_id = ev.team_id AND ur.role = 'player'::app_role), 0)
    )::bigint AS expected
    FROM ev GROUP BY ev.d
  ),
  responded_per_day AS (
    SELECT ev.d, COUNT(*)::bigint AS responded
    FROM public.rsvps r JOIN ev ON ev.id = r.event_id
    WHERE r.status IS NOT NULL
      AND ((r.child_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.child_team_assignments cta WHERE cta.team_id = ev.team_id AND cta.child_id = r.child_id))
        OR (r.child_id IS NULL AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.team_id = ev.team_id AND ur.user_id = r.user_id AND ur.role = 'player'::app_role)))
    GROUP BY ev.d
  ),
  dd AS (SELECT generate_series((_start AT TIME ZONE 'UTC')::date, (_end AT TIME ZONE 'UTC')::date, interval '1 day')::date AS d)
  SELECT dd.d,
         CASE WHEN COALESCE(e.expected,0) > 0
              THEN ROUND((COALESCE(r.responded,0)::numeric / e.expected::numeric) * 100, 1)
              ELSE NULL END,
         COALESCE(r.responded, 0),
         COALESCE(e.expected, 0)
  FROM dd
  LEFT JOIN expected_per_day e ON e.d = dd.d
  LEFT JOIN responded_per_day r ON r.d = dd.d
  ORDER BY dd.d;
END;
$function$;