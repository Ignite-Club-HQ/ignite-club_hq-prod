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
      SELECT (cm.created_at AT TIME ZONE 'UTC')::date AS d, COUNT(*)::bigint AS n
      FROM public.club_messages cm
      WHERE cm.deleted_at IS NULL AND cm.created_at >= _start AND cm.created_at <= _end
      GROUP BY 1
    ),
    t AS (
      SELECT d, SUM(n)::bigint AS n FROM (
        SELECT (tm.created_at AT TIME ZONE 'UTC')::date AS d, COUNT(*)::bigint AS n
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
      ) u GROUP BY d
    ),
    dd AS (
      SELECT generate_series((_start AT TIME ZONE 'UTC')::date, (_end AT TIME ZONE 'UTC')::date, interval '1 day')::date AS d
    )
    SELECT dd.d, COALESCE(c.n, 0), COALESCE(t.n, 0)
    FROM dd
    LEFT JOIN c ON c.d = dd.d
    LEFT JOIN t ON t.d = dd.d
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
    SELECT (cm.created_at AT TIME ZONE 'UTC')::date AS d, COUNT(*)::bigint AS n
    FROM public.club_messages cm
    WHERE cm.club_id = _club_id AND cm.deleted_at IS NULL
      AND cm.created_at >= _start AND cm.created_at <= _end
    GROUP BY 1
  ),
  t AS (
    SELECT d, SUM(n)::bigint AS n FROM (
      SELECT (tm.created_at AT TIME ZONE 'UTC')::date AS d, COUNT(*)::bigint AS n
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
    ) u GROUP BY d
  ),
  dd AS (
    SELECT generate_series((_start AT TIME ZONE 'UTC')::date, (_end AT TIME ZONE 'UTC')::date, interval '1 day')::date AS d
  )
  SELECT dd.d, COALESCE(c.n, 0), COALESCE(t.n, 0)
  FROM dd
  LEFT JOIN c ON c.d = dd.d
  LEFT JOIN t ON t.d = dd.d
  ORDER BY dd.d;
END;
$$;

GRANT EXECUTE ON FUNCTION public.club_engagement_message_volume(uuid, timestamptz, timestamptz) TO authenticated;