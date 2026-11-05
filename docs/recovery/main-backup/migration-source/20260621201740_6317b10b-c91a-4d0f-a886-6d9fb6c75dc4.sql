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
  IF _club_id IS NULL THEN
    IF NOT has_role(auth.uid(), 'app_admin'::app_role) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
    RETURN QUERY
    SELECT DISTINCT (l.started_at AT TIME ZONE 'UTC')::date AS day, l.user_id
    FROM public.user_activity_logs l
    WHERE l.started_at >= _start
      AND l.started_at <= _end
      AND l.user_id IS NOT NULL;
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
  WITH members AS (
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.club_id = _club_id AND ur.user_id IS NOT NULL
  )
  SELECT DISTINCT (l.started_at AT TIME ZONE 'UTC')::date AS day, l.user_id
  FROM public.user_activity_logs l
  JOIN members m ON m.user_id = l.user_id
  WHERE l.started_at >= _start
    AND l.started_at <= _end;
END;
$$;

GRANT EXECUTE ON FUNCTION public.club_engagement_active_users(uuid, timestamptz, timestamptz) TO authenticated;


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
  IF _club_id IS NULL THEN
    IF NOT has_role(auth.uid(), 'app_admin'::app_role) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;

    RETURN QUERY
    WITH event_ids AS (
      SELECT e.id
      FROM public.events e
      WHERE COALESCE(e.is_cancelled, false) = false
        AND e.type IN ('game','training')
        AND e.start_time >= _start
        AND e.start_time <= _end
    )
    SELECT
      (SELECT COUNT(*)::bigint FROM public.club_messages cm
         WHERE cm.deleted_at IS NULL AND cm.created_at >= _start AND cm.created_at <= _end),
      (
        (SELECT COUNT(*)::bigint FROM public.team_messages tm
           WHERE tm.deleted_at IS NULL AND tm.created_at >= _start AND tm.created_at <= _end)
        +
        (SELECT COUNT(*)::bigint FROM public.group_messages gm
           WHERE gm.deleted_at IS NULL AND gm.created_at >= _start AND gm.created_at <= _end)
        +
        (SELECT COUNT(*)::bigint FROM public.club_admin_messages cam
           WHERE cam.deleted_at IS NULL AND cam.created_at >= _start AND cam.created_at <= _end)
      ),
      (SELECT COUNT(*)::bigint FROM public.message_reactions mr
         WHERE mr.created_at >= _start AND mr.created_at <= _end),
      (
        (SELECT COUNT(*)::bigint FROM public.association_broadcasts ab
           WHERE ab.created_at >= _start AND ab.created_at <= _end)
        +
        (SELECT COUNT(*)::bigint FROM public.competition_broadcasts cb
           WHERE cb.created_at >= _start AND cb.created_at <= _end)
      ),
      (SELECT COUNT(*)::bigint FROM event_ids),
      (SELECT COUNT(*)::bigint FROM public.rsvps r WHERE r.event_id IN (SELECT id FROM event_ids)),
      (SELECT COUNT(*)::bigint FROM public.rsvps r WHERE r.event_id IN (SELECT id FROM event_ids) AND r.status IS NOT NULL),
      (SELECT COUNT(*)::bigint FROM public.rsvps r WHERE r.event_id IN (SELECT id FROM event_ids) AND r.status = 'going'),
      (SELECT COUNT(*)::bigint FROM public.photos p
         WHERE p.deleted_at IS NULL AND p.created_at >= _start AND p.created_at <= _end);
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
  WITH club_team_ids AS (
    SELECT t.id FROM public.teams t WHERE t.club_id = _club_id
  ),
  club_event_ids AS (
    SELECT e.id
    FROM public.events e
    LEFT JOIN public.teams te ON te.id = e.team_id
    WHERE COALESCE(e.is_cancelled, false) = false
      AND e.type IN ('game','training')
      AND e.start_time >= _start
      AND e.start_time <= _end
      AND (e.club_id = _club_id OR te.club_id = _club_id)
  ),
  club_group_ids AS (
    SELECT cg.id FROM public.chat_groups cg
    WHERE cg.deleted_at IS NULL
      AND (cg.club_id = _club_id OR cg.team_id IN (SELECT id FROM club_team_ids))
  ),
  club_admin_conversation_ids AS (
    SELECT cac.id FROM public.club_admin_conversations cac WHERE cac.club_id = _club_id
  )
  SELECT
    (SELECT COUNT(*)::bigint FROM public.club_messages cm
       WHERE cm.club_id = _club_id AND cm.deleted_at IS NULL
         AND cm.created_at >= _start AND cm.created_at <= _end),
    (
      (SELECT COUNT(*)::bigint FROM public.team_messages tm
         WHERE tm.team_id IN (SELECT id FROM club_team_ids) AND tm.deleted_at IS NULL
           AND tm.created_at >= _start AND tm.created_at <= _end)
      +
      (SELECT COUNT(*)::bigint FROM public.group_messages gm
         WHERE gm.group_id IN (SELECT id FROM club_group_ids) AND gm.deleted_at IS NULL
           AND gm.created_at >= _start AND gm.created_at <= _end)
      +
      (SELECT COUNT(*)::bigint FROM public.club_admin_messages cam
         WHERE cam.conversation_id IN (SELECT id FROM club_admin_conversation_ids)
           AND cam.deleted_at IS NULL
           AND cam.created_at >= _start AND cam.created_at <= _end)
    ),
    (SELECT COUNT(*)::bigint FROM public.message_reactions mr
       LEFT JOIN public.club_messages cm ON cm.id = mr.club_message_id AND cm.deleted_at IS NULL
       LEFT JOIN public.team_messages tm ON tm.id = mr.team_message_id AND tm.deleted_at IS NULL
       LEFT JOIN public.group_messages gm ON gm.id = mr.group_message_id AND gm.deleted_at IS NULL
       LEFT JOIN public.club_admin_messages cam ON cam.id = mr.club_admin_message_id AND cam.deleted_at IS NULL
       WHERE mr.created_at >= _start AND mr.created_at <= _end
         AND (
           cm.club_id = _club_id
           OR tm.team_id IN (SELECT id FROM club_team_ids)
           OR gm.group_id IN (SELECT id FROM club_group_ids)
           OR cam.conversation_id IN (SELECT id FROM club_admin_conversation_ids)
         )),
    (
      (SELECT COUNT(*)::bigint FROM public.association_broadcasts ab
         WHERE _club_id = ANY(ab.club_ids)
           AND ab.created_at >= _start AND ab.created_at <= _end)
      +
      (SELECT COUNT(*)::bigint FROM public.competition_broadcasts cb
         WHERE EXISTS (
           SELECT 1 FROM public.competition_entries ce
           JOIN public.teams te ON te.id = ce.team_id
           WHERE ce.competition_id = cb.competition_id AND te.club_id = _club_id
         )
         AND cb.created_at >= _start AND cb.created_at <= _end)
    ),
    (SELECT COUNT(*)::bigint FROM club_event_ids),
    (SELECT COUNT(*)::bigint FROM public.rsvps r WHERE r.event_id IN (SELECT id FROM club_event_ids)),
    (SELECT COUNT(*)::bigint FROM public.rsvps r WHERE r.event_id IN (SELECT id FROM club_event_ids) AND r.status IS NOT NULL),
    (SELECT COUNT(*)::bigint FROM public.rsvps r WHERE r.event_id IN (SELECT id FROM club_event_ids) AND r.status = 'going'),
    (SELECT COUNT(*)::bigint FROM public.photos p
       WHERE p.club_id = _club_id AND p.deleted_at IS NULL
         AND p.created_at >= _start AND p.created_at <= _end);
END;
$$;

GRANT EXECUTE ON FUNCTION public.club_engagement_totals(uuid, timestamptz, timestamptz) TO authenticated;


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
  IF _club_id IS NULL THEN
    IF NOT has_role(auth.uid(), 'app_admin'::app_role) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
    RETURN QUERY
    WITH c AS (
      SELECT (cm.created_at AT TIME ZONE 'UTC')::date AS day, COUNT(*)::bigint AS n
      FROM public.club_messages cm
      WHERE cm.deleted_at IS NULL AND cm.created_at >= _start AND cm.created_at <= _end
      GROUP BY 1
    ),
    t AS (
      SELECT day, SUM(n)::bigint AS n FROM (
        SELECT (tm.created_at AT TIME ZONE 'UTC')::date AS day, COUNT(*)::bigint AS n
        FROM public.team_messages tm
        WHERE tm.deleted_at IS NULL AND tm.created_at >= _start AND tm.created_at <= _end
        GROUP BY 1
        UNION ALL
        SELECT (gm.created_at AT TIME ZONE 'UTC')::date, COUNT(*)::bigint
        FROM public.group_messages gm
        WHERE gm.deleted_at IS NULL AND gm.created_at >= _start AND gm.created_at <= _end
        GROUP BY 1
        UNION ALL
        SELECT (cam.created_at AT TIME ZONE 'UTC')::date, COUNT(*)::bigint
        FROM public.club_admin_messages cam
        WHERE cam.deleted_at IS NULL AND cam.created_at >= _start AND cam.created_at <= _end
        GROUP BY 1
      ) u GROUP BY day
    ),
    d AS (
      SELECT generate_series((_start AT TIME ZONE 'UTC')::date, (_end AT TIME ZONE 'UTC')::date, interval '1 day')::date AS day
    )
    SELECT d.day, COALESCE(c.n, 0), COALESCE(t.n, 0)
    FROM d LEFT JOIN c USING (day) LEFT JOIN t USING (day) ORDER BY d.day;
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
  WITH club_team_ids AS (
    SELECT t.id FROM public.teams t WHERE t.club_id = _club_id
  ),
  club_group_ids AS (
    SELECT cg.id FROM public.chat_groups cg
    WHERE cg.deleted_at IS NULL
      AND (cg.club_id = _club_id OR cg.team_id IN (SELECT id FROM club_team_ids))
  ),
  club_admin_conversation_ids AS (
    SELECT cac.id FROM public.club_admin_conversations cac WHERE cac.club_id = _club_id
  ),
  c AS (
    SELECT (cm.created_at AT TIME ZONE 'UTC')::date AS day, COUNT(*)::bigint AS n
    FROM public.club_messages cm
    WHERE cm.club_id = _club_id AND cm.deleted_at IS NULL
      AND cm.created_at >= _start AND cm.created_at <= _end
    GROUP BY 1
  ),
  t AS (
    SELECT day, SUM(n)::bigint AS n FROM (
      SELECT (tm.created_at AT TIME ZONE 'UTC')::date AS day, COUNT(*)::bigint AS n
      FROM public.team_messages tm
      WHERE tm.team_id IN (SELECT id FROM club_team_ids) AND tm.deleted_at IS NULL
        AND tm.created_at >= _start AND tm.created_at <= _end
      GROUP BY 1
      UNION ALL
      SELECT (gm.created_at AT TIME ZONE 'UTC')::date, COUNT(*)::bigint
      FROM public.group_messages gm
      WHERE gm.group_id IN (SELECT id FROM club_group_ids) AND gm.deleted_at IS NULL
        AND gm.created_at >= _start AND gm.created_at <= _end
      GROUP BY 1
      UNION ALL
      SELECT (cam.created_at AT TIME ZONE 'UTC')::date, COUNT(*)::bigint
      FROM public.club_admin_messages cam
      WHERE cam.conversation_id IN (SELECT id FROM club_admin_conversation_ids)
        AND cam.deleted_at IS NULL
        AND cam.created_at >= _start AND cam.created_at <= _end
      GROUP BY 1
    ) u GROUP BY day
  ),
  d AS (
    SELECT generate_series((_start AT TIME ZONE 'UTC')::date, (_end AT TIME ZONE 'UTC')::date, interval '1 day')::date AS day
  )
  SELECT d.day, COALESCE(c.n, 0), COALESCE(t.n, 0)
  FROM d LEFT JOIN c USING (day) LEFT JOIN t USING (day) ORDER BY d.day;
END;
$$;

GRANT EXECUTE ON FUNCTION public.club_engagement_message_volume(uuid, timestamptz, timestamptz) TO authenticated;