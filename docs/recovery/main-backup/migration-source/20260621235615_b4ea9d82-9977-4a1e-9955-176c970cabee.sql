
CREATE OR REPLACE FUNCTION public.club_engagement_benchmarks(
  _club_id uuid,
  _start timestamptz,
  _end timestamptz,
  _prev_start timestamptz,
  _prev_end timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _is_app_admin boolean;
  _is_club_admin boolean;
  result jsonb;
  _members uuid[];
  _now timestamptz := now();
  _dau int; _wau int; _mau int; _prev_wau int; _prev_mau int;
  _active_range int;
  _total int;
  _posters int; _reactors_only int; _readers_only int; _inactive int;
  _club_msg_total int; _club_msg_reads int;
  _prev_club_msg_total int; _prev_club_msg_reads int;
  _bcast_total int; _bcast_reads int;
  _prev_bcast_total int; _prev_bcast_reads int;
  _ann_total int; _ann_views int;
  _prev_ann_total int; _prev_ann_views int;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id = _caller AND role = 'app_admin') INTO _is_app_admin;

  IF _club_id IS NULL THEN
    IF NOT _is_app_admin THEN RAISE EXCEPTION 'Forbidden'; END IF;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = _caller AND club_id = _club_id
        AND role IN ('club_admin','committee_member')
    ) INTO _is_club_admin;
    IF NOT (_is_app_admin OR _is_club_admin) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  END IF;

  IF _club_id IS NULL THEN
    SELECT array_agg(DISTINCT u) FROM (
      SELECT profile_id AS u FROM club_players WHERE is_active AND profile_id IS NOT NULL
      UNION
      SELECT cg.guardian_id FROM club_players cp
        JOIN child_guardians cg ON cg.child_id = cp.child_id
        WHERE cp.is_active AND cp.child_id IS NOT NULL
    ) s INTO _members;
  ELSE
    SELECT array_agg(DISTINCT u) FROM (
      SELECT profile_id AS u FROM club_players
        WHERE club_id = _club_id AND is_active AND profile_id IS NOT NULL
      UNION
      SELECT cg.guardian_id FROM club_players cp
        JOIN child_guardians cg ON cg.child_id = cp.child_id
        WHERE cp.club_id = _club_id AND cp.is_active AND cp.child_id IS NOT NULL
    ) s INTO _members;
  END IF;

  _members := COALESCE(_members, ARRAY[]::uuid[]);
  _total := COALESCE(array_length(_members, 1), 0);

  SELECT COUNT(DISTINCT user_id) INTO _dau FROM user_activity_logs
    WHERE user_id = ANY(_members) AND created_at >= _now - interval '1 day';
  SELECT COUNT(DISTINCT user_id) INTO _wau FROM user_activity_logs
    WHERE user_id = ANY(_members) AND created_at >= _now - interval '7 days';
  SELECT COUNT(DISTINCT user_id) INTO _mau FROM user_activity_logs
    WHERE user_id = ANY(_members) AND created_at >= _now - interval '30 days';
  SELECT COUNT(DISTINCT user_id) INTO _prev_wau FROM user_activity_logs
    WHERE user_id = ANY(_members) AND created_at >= _now - interval '14 days' AND created_at < _now - interval '7 days';
  SELECT COUNT(DISTINCT user_id) INTO _prev_mau FROM user_activity_logs
    WHERE user_id = ANY(_members) AND created_at >= _now - interval '60 days' AND created_at < _now - interval '30 days';

  WITH active_set AS (
    SELECT DISTINCT user_id FROM user_activity_logs
      WHERE user_id = ANY(_members) AND created_at >= _start AND created_at <= _end
    UNION
    SELECT DISTINCT author_id FROM club_messages
      WHERE author_id = ANY(_members) AND created_at BETWEEN _start AND _end AND deleted_at IS NULL
        AND (_club_id IS NULL OR club_id = _club_id)
    UNION
    SELECT DISTINCT user_id FROM message_reactions
      WHERE user_id = ANY(_members) AND created_at BETWEEN _start AND _end
    UNION
    SELECT DISTINCT user_id FROM rsvps
      WHERE user_id = ANY(_members) AND updated_at BETWEEN _start AND _end
    UNION
    SELECT DISTINCT uploader_id FROM photos
      WHERE uploader_id = ANY(_members) AND created_at BETWEEN _start AND _end AND deleted_at IS NULL
        AND (_club_id IS NULL OR club_id = _club_id)
  )
  SELECT COUNT(*) INTO _active_range FROM active_set;

  WITH posted AS (
    SELECT DISTINCT u FROM (
      SELECT author_id u FROM club_messages
        WHERE author_id = ANY(_members) AND created_at BETWEEN _start AND _end AND deleted_at IS NULL
          AND (_club_id IS NULL OR club_id = _club_id)
      UNION
      SELECT tm.author_id FROM team_messages tm
        WHERE tm.author_id = ANY(_members) AND tm.created_at BETWEEN _start AND _end AND tm.deleted_at IS NULL
          AND (_club_id IS NULL OR EXISTS (SELECT 1 FROM teams t WHERE t.id = tm.team_id AND t.club_id = _club_id))
      UNION
      SELECT gm.author_id FROM group_messages gm
        WHERE gm.author_id = ANY(_members) AND gm.created_at BETWEEN _start AND _end AND gm.deleted_at IS NULL
    ) s
  ),
  reacted AS (
    SELECT DISTINCT user_id u FROM message_reactions
      WHERE user_id = ANY(_members) AND created_at BETWEEN _start AND _end
  ),
  readers AS (
    SELECT DISTINCT user_id u FROM message_reads
      WHERE user_id = ANY(_members) AND read_at BETWEEN _start AND _end
  )
  SELECT
    (SELECT COUNT(*) FROM posted),
    (SELECT COUNT(*) FROM reacted WHERE u NOT IN (SELECT u FROM posted)),
    (SELECT COUNT(*) FROM readers
       WHERE u NOT IN (SELECT u FROM posted) AND u NOT IN (SELECT u FROM reacted))
  INTO _posters, _reactors_only, _readers_only;

  _inactive := GREATEST(_total - _posters - _reactors_only - _readers_only, 0);

  IF _total > 0 THEN
    SELECT COUNT(*), COALESCE(SUM(read_users),0)
    INTO _club_msg_total, _club_msg_reads
    FROM (
      SELECT cm.id AS msg_id, (
        SELECT COUNT(DISTINCT mr.user_id) FROM message_reads mr
        WHERE mr.club_message_id = cm.id AND mr.user_id = ANY(_members)
      ) AS read_users
      FROM club_messages cm
      WHERE cm.created_at BETWEEN _start AND _end
        AND cm.deleted_at IS NULL
        AND (_club_id IS NULL OR cm.club_id = _club_id)
      UNION ALL
      SELECT gm.id AS msg_id, (
        SELECT COUNT(DISTINCT mr.user_id) FROM message_reads mr
        WHERE mr.group_message_id = gm.id AND mr.user_id = ANY(_members)
      ) AS read_users
      FROM group_messages gm
      JOIN chat_groups cg ON cg.id = gm.group_id
      WHERE gm.created_at BETWEEN _start AND _end
        AND gm.deleted_at IS NULL
        AND cg.deleted_at IS NULL
        AND cg.team_id IS NULL
        AND cg.mini_league_id IS NULL
        AND cg.competition_id IS NULL
        AND (_club_id IS NULL OR cg.club_id = _club_id)
      LIMIT 1000
    ) s;

    SELECT COUNT(*), COALESCE(SUM(read_users),0)
    INTO _prev_club_msg_total, _prev_club_msg_reads
    FROM (
      SELECT cm.id AS msg_id, (
        SELECT COUNT(DISTINCT mr.user_id) FROM message_reads mr
        WHERE mr.club_message_id = cm.id AND mr.user_id = ANY(_members)
      ) AS read_users
      FROM club_messages cm
      WHERE cm.created_at BETWEEN _prev_start AND _prev_end
        AND cm.deleted_at IS NULL
        AND (_club_id IS NULL OR cm.club_id = _club_id)
      UNION ALL
      SELECT gm.id AS msg_id, (
        SELECT COUNT(DISTINCT mr.user_id) FROM message_reads mr
        WHERE mr.group_message_id = gm.id AND mr.user_id = ANY(_members)
      ) AS read_users
      FROM group_messages gm
      JOIN chat_groups cg ON cg.id = gm.group_id
      WHERE gm.created_at BETWEEN _prev_start AND _prev_end
        AND gm.deleted_at IS NULL
        AND cg.deleted_at IS NULL
        AND cg.team_id IS NULL
        AND cg.mini_league_id IS NULL
        AND cg.competition_id IS NULL
        AND (_club_id IS NULL OR cg.club_id = _club_id)
      LIMIT 1000
    ) s;

    SELECT COUNT(*), COALESCE(SUM(read_users),0)
    INTO _bcast_total, _bcast_reads
    FROM (
      SELECT bm.id, (
        SELECT COUNT(DISTINCT mr.user_id) FROM message_reads mr
        WHERE mr.broadcast_message_id = bm.id AND mr.user_id = ANY(_members)
      ) AS read_users
      FROM broadcast_messages bm
      WHERE bm.created_at BETWEEN _start AND _end
        AND (_club_id IS NULL OR bm.club_id = _club_id)
      LIMIT 500
    ) s;

    SELECT COUNT(*), COALESCE(SUM(read_users),0)
    INTO _prev_bcast_total, _prev_bcast_reads
    FROM (
      SELECT bm.id, (
        SELECT COUNT(DISTINCT mr.user_id) FROM message_reads mr
        WHERE mr.broadcast_message_id = bm.id AND mr.user_id = ANY(_members)
      ) AS read_users
      FROM broadcast_messages bm
      WHERE bm.created_at BETWEEN _prev_start AND _prev_end
        AND (_club_id IS NULL OR bm.club_id = _club_id)
      LIMIT 500
    ) s;

    SELECT COUNT(*), COALESCE(SUM(view_users),0)
    INTO _ann_total, _ann_views
    FROM (
      SELECT e.id, (
        SELECT COUNT(DISTINCT ev.user_id) FROM event_views ev
        WHERE ev.event_id = e.id AND ev.user_id = ANY(_members)
          AND ev.viewed_at <= e.created_at + interval '7 days'
      ) AS view_users
      FROM events e
      WHERE e.created_at BETWEEN _start AND _end
        AND (_club_id IS NULL OR e.club_id = _club_id
             OR EXISTS (SELECT 1 FROM teams t WHERE t.id = e.team_id AND t.club_id = _club_id))
      LIMIT 500
    ) s;

    SELECT COUNT(*), COALESCE(SUM(view_users),0)
    INTO _prev_ann_total, _prev_ann_views
    FROM (
      SELECT e.id, (
        SELECT COUNT(DISTINCT ev.user_id) FROM event_views ev
        WHERE ev.event_id = e.id AND ev.user_id = ANY(_members)
          AND ev.viewed_at <= e.created_at + interval '7 days'
      ) AS view_users
      FROM events e
      WHERE e.created_at BETWEEN _prev_start AND _prev_end
        AND (_club_id IS NULL OR e.club_id = _club_id
             OR EXISTS (SELECT 1 FROM teams t WHERE t.id = e.team_id AND t.club_id = _club_id))
      LIMIT 500
    ) s;
  END IF;

  result := jsonb_build_object(
    'total_members', _total,
    'active_members', _active_range,
    'inactive_members', GREATEST(_total - _active_range, 0),
    'dau', _dau, 'wau', _wau, 'mau', _mau,
    'prev_wau', _prev_wau, 'prev_mau', _prev_mau,
    'posters', _posters,
    'reactors_only', _reactors_only,
    'readers_only', _readers_only,
    'inactive_msg', _inactive,
    'club_msg_total', COALESCE(_club_msg_total,0),
    'club_msg_possible', COALESCE(_club_msg_total,0) * _total,
    'club_msg_reads', COALESCE(_club_msg_reads,0),
    'prev_club_msg_possible', COALESCE(_prev_club_msg_total,0) * _total,
    'prev_club_msg_reads', COALESCE(_prev_club_msg_reads,0),
    'bcast_total', COALESCE(_bcast_total,0),
    'bcast_possible', COALESCE(_bcast_total,0) * _total,
    'bcast_reads', COALESCE(_bcast_reads,0),
    'prev_bcast_possible', COALESCE(_prev_bcast_total,0) * _total,
    'prev_bcast_reads', COALESCE(_prev_bcast_reads,0),
    'ann_total', COALESCE(_ann_total,0),
    'ann_possible', COALESCE(_ann_total,0) * _total,
    'ann_views', COALESCE(_ann_views,0),
    'prev_ann_possible', COALESCE(_prev_ann_total,0) * _total,
    'prev_ann_views', COALESCE(_prev_ann_views,0)
  );

  RETURN result;
END;
$$;
