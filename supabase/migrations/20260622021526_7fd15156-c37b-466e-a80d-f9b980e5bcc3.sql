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
SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _is_app_admin boolean;
  _is_club_admin boolean;
  result jsonb;
  _members uuid[];
  _now timestamptz := now();
  _dau int := 0;
  _wau int := 0;
  _mau int := 0;
  _prev_wau int := 0;
  _prev_mau int := 0;
  _active_range int := 0;
  _total int := 0;
  _posters int := 0;
  _reactors_only int := 0;
  _readers_only int := 0;
  _inactive int := 0;
  _club_msg_total int := 0;
  _club_msg_reads int := 0;
  _prev_club_msg_total int := 0;
  _prev_club_msg_reads int := 0;
  _team_msg_total int := 0;
  _team_msg_reads int := 0;
  _team_msg_possible bigint := 0;
  _prev_team_msg_total int := 0;
  _prev_team_msg_reads int := 0;
  _prev_team_msg_possible bigint := 0;
  _bcast_total int := 0;
  _bcast_reads int := 0;
  _prev_bcast_total int := 0;
  _prev_bcast_reads int := 0;
  _ann_total int := 0;
  _ann_views int := 0;
  _prev_ann_total int := 0;
  _prev_ann_views int := 0;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _caller AND ur.role = 'app_admin') INTO _is_app_admin;

  IF _club_id IS NULL THEN
    IF NOT _is_app_admin THEN RAISE EXCEPTION 'Forbidden'; END IF;
  ELSE
    SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _caller AND ur.club_id = _club_id AND ur.role IN ('club_admin','committee_member')) INTO _is_club_admin;
    IF NOT (_is_app_admin OR _is_club_admin) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  END IF;

  IF _club_id IS NULL THEN
    SELECT array_agg(DISTINCT u) FROM (
      SELECT ur.user_id AS u FROM public.user_roles ur WHERE ur.user_id IS NOT NULL
      UNION SELECT cp.profile_id FROM public.club_players cp WHERE cp.is_active AND cp.profile_id IS NOT NULL
      UNION SELECT cg.guardian_id FROM public.club_players cp JOIN public.child_guardians cg ON cg.child_id = cp.child_id WHERE cp.is_active AND cp.child_id IS NOT NULL
    ) s INTO _members;
  ELSE
    SELECT array_agg(DISTINCT u) FROM (
      SELECT ur.user_id AS u FROM public.user_roles ur WHERE ur.club_id = _club_id AND ur.user_id IS NOT NULL
      UNION SELECT cp.profile_id FROM public.club_players cp WHERE cp.club_id = _club_id AND cp.is_active AND cp.profile_id IS NOT NULL
      UNION SELECT cg.guardian_id FROM public.club_players cp JOIN public.child_guardians cg ON cg.child_id = cp.child_id WHERE cp.club_id = _club_id AND cp.is_active AND cp.child_id IS NOT NULL
    ) s INTO _members;
  END IF;

  _members := COALESCE(_members, ARRAY[]::uuid[]);
  _total := COALESCE(array_length(_members, 1), 0);

  SELECT COUNT(DISTINCT ual.user_id) INTO _dau FROM public.user_activity_logs ual WHERE ual.user_id = ANY(_members) AND ual.created_at >= _now - interval '1 day';
  SELECT COUNT(DISTINCT ual.user_id) INTO _wau FROM public.user_activity_logs ual WHERE ual.user_id = ANY(_members) AND ual.created_at >= _now - interval '7 days';
  SELECT COUNT(DISTINCT ual.user_id) INTO _mau FROM public.user_activity_logs ual WHERE ual.user_id = ANY(_members) AND ual.created_at >= _now - interval '30 days';
  SELECT COUNT(DISTINCT ual.user_id) INTO _prev_wau FROM public.user_activity_logs ual WHERE ual.user_id = ANY(_members) AND ual.created_at >= _now - interval '14 days' AND ual.created_at < _now - interval '7 days';
  SELECT COUNT(DISTINCT ual.user_id) INTO _prev_mau FROM public.user_activity_logs ual WHERE ual.user_id = ANY(_members) AND ual.created_at >= _now - interval '60 days' AND ual.created_at < _now - interval '30 days';

  WITH club_team_ids AS (SELECT t.id FROM public.teams t WHERE _club_id IS NOT NULL AND t.club_id = _club_id),
  club_group_ids AS (SELECT cg.id FROM public.chat_groups cg WHERE cg.deleted_at IS NULL AND _club_id IS NOT NULL AND (cg.club_id = _club_id OR cg.team_id IN (SELECT id FROM club_team_ids))),
  club_admin_conversation_ids AS (SELECT cac.id FROM public.club_admin_conversations cac WHERE _club_id IS NOT NULL AND cac.club_id = _club_id),
  active_set AS (
    SELECT DISTINCT ual.user_id FROM public.user_activity_logs ual WHERE ual.user_id = ANY(_members) AND ual.created_at >= _start AND ual.created_at <= _end
    UNION SELECT DISTINCT cm.author_id FROM public.club_messages cm WHERE cm.author_id = ANY(_members) AND cm.created_at BETWEEN _start AND _end AND cm.deleted_at IS NULL AND (_club_id IS NULL OR cm.club_id = _club_id)
    UNION SELECT DISTINCT tm.author_id FROM public.team_messages tm WHERE tm.author_id = ANY(_members) AND tm.created_at BETWEEN _start AND _end AND tm.deleted_at IS NULL AND (_club_id IS NULL OR tm.team_id IN (SELECT id FROM club_team_ids))
    UNION SELECT DISTINCT gm.author_id FROM public.group_messages gm WHERE gm.author_id = ANY(_members) AND gm.created_at BETWEEN _start AND _end AND gm.deleted_at IS NULL AND (_club_id IS NULL OR gm.group_id IN (SELECT id FROM club_group_ids))
    UNION SELECT DISTINCT cam.author_id FROM public.club_admin_messages cam WHERE cam.author_id = ANY(_members) AND cam.created_at BETWEEN _start AND _end AND cam.deleted_at IS NULL AND (_club_id IS NULL OR cam.conversation_id IN (SELECT id FROM club_admin_conversation_ids))
    UNION SELECT DISTINCT mr.user_id FROM public.message_reactions mr WHERE mr.user_id = ANY(_members) AND mr.created_at BETWEEN _start AND _end AND (_club_id IS NULL OR mr.club_message_id IN (SELECT cm.id FROM public.club_messages cm WHERE cm.club_id = _club_id) OR mr.team_message_id IN (SELECT tm.id FROM public.team_messages tm WHERE tm.team_id IN (SELECT id FROM club_team_ids)) OR mr.group_message_id IN (SELECT gm.id FROM public.group_messages gm WHERE gm.group_id IN (SELECT id FROM club_group_ids)) OR mr.club_admin_message_id IN (SELECT cam.id FROM public.club_admin_messages cam WHERE cam.conversation_id IN (SELECT id FROM club_admin_conversation_ids)))
    UNION SELECT DISTINCT r.user_id FROM public.rsvps r JOIN public.events e ON e.id = r.event_id LEFT JOIN public.teams et ON et.id = e.team_id WHERE r.user_id = ANY(_members) AND r.updated_at BETWEEN _start AND _end AND (_club_id IS NULL OR e.club_id = _club_id OR et.club_id = _club_id)
    UNION SELECT DISTINCT p.uploader_id FROM public.photos p WHERE p.uploader_id = ANY(_members) AND p.created_at BETWEEN _start AND _end AND p.deleted_at IS NULL AND (_club_id IS NULL OR p.club_id = _club_id OR p.team_id IN (SELECT id FROM club_team_ids))
  )
  SELECT COUNT(*) INTO _active_range FROM active_set;

  WITH club_team_ids AS (SELECT t.id FROM public.teams t WHERE _club_id IS NOT NULL AND t.club_id = _club_id),
  club_group_ids AS (SELECT cg.id FROM public.chat_groups cg WHERE cg.deleted_at IS NULL AND _club_id IS NOT NULL AND (cg.club_id = _club_id OR cg.team_id IN (SELECT id FROM club_team_ids))),
  club_admin_conversation_ids AS (SELECT cac.id FROM public.club_admin_conversations cac WHERE _club_id IS NOT NULL AND cac.club_id = _club_id),
  posted AS (SELECT DISTINCT u FROM (
      SELECT cm.author_id AS u FROM public.club_messages cm WHERE cm.author_id = ANY(_members) AND cm.created_at BETWEEN _start AND _end AND cm.deleted_at IS NULL AND (_club_id IS NULL OR cm.club_id = _club_id)
      UNION SELECT tm.author_id FROM public.team_messages tm WHERE tm.author_id = ANY(_members) AND tm.created_at BETWEEN _start AND _end AND tm.deleted_at IS NULL AND (_club_id IS NULL OR tm.team_id IN (SELECT id FROM club_team_ids))
      UNION SELECT gm.author_id FROM public.group_messages gm WHERE gm.author_id = ANY(_members) AND gm.created_at BETWEEN _start AND _end AND gm.deleted_at IS NULL AND (_club_id IS NULL OR gm.group_id IN (SELECT id FROM club_group_ids))
      UNION SELECT cam.author_id FROM public.club_admin_messages cam WHERE cam.author_id = ANY(_members) AND cam.created_at BETWEEN _start AND _end AND cam.deleted_at IS NULL AND (_club_id IS NULL OR cam.conversation_id IN (SELECT id FROM club_admin_conversation_ids))) p),
  reacted AS (SELECT DISTINCT mr.user_id AS u FROM public.message_reactions mr WHERE mr.user_id = ANY(_members) AND mr.created_at BETWEEN _start AND _end AND (_club_id IS NULL OR mr.club_message_id IN (SELECT cm.id FROM public.club_messages cm WHERE cm.club_id = _club_id) OR mr.team_message_id IN (SELECT tm.id FROM public.team_messages tm WHERE tm.team_id IN (SELECT id FROM club_team_ids)) OR mr.group_message_id IN (SELECT gm.id FROM public.group_messages gm WHERE gm.group_id IN (SELECT id FROM club_group_ids)) OR mr.club_admin_message_id IN (SELECT cam.id FROM public.club_admin_messages cam WHERE cam.conversation_id IN (SELECT id FROM club_admin_conversation_ids)))),
  readers AS (SELECT DISTINCT mr.user_id AS u FROM public.message_reads mr WHERE mr.user_id = ANY(_members) AND mr.read_at BETWEEN _start AND _end AND (_club_id IS NULL OR mr.club_message_id IN (SELECT cm.id FROM public.club_messages cm WHERE cm.club_id = _club_id) OR mr.team_message_id IN (SELECT tm.id FROM public.team_messages tm WHERE tm.team_id IN (SELECT id FROM club_team_ids)) OR mr.group_message_id IN (SELECT gm.id FROM public.group_messages gm WHERE gm.group_id IN (SELECT id FROM club_group_ids)) OR mr.club_admin_message_id IN (SELECT cam.id FROM public.club_admin_messages cam WHERE cam.conversation_id IN (SELECT id FROM club_admin_conversation_ids))))
  SELECT (SELECT COUNT(*) FROM posted),
         (SELECT COUNT(*) FROM reacted WHERE u NOT IN (SELECT u FROM posted)),
         (SELECT COUNT(*) FROM readers WHERE u NOT IN (SELECT u FROM posted) AND u NOT IN (SELECT u FROM reacted))
  INTO _posters, _reactors_only, _readers_only;

  _inactive := GREATEST(0, _total - _posters - _reactors_only - _readers_only);

  WITH club_group_ids AS (SELECT cg.id FROM public.chat_groups cg WHERE cg.deleted_at IS NULL AND _club_id IS NOT NULL AND cg.club_id = _club_id AND cg.team_id IS NULL AND cg.mini_league_id IS NULL AND cg.competition_id IS NULL),
  current_msgs AS (
    SELECT cm.id, 'club'::text AS kind FROM public.club_messages cm WHERE cm.created_at BETWEEN _start AND _end AND cm.deleted_at IS NULL AND (_club_id IS NULL OR cm.club_id = _club_id)
    UNION ALL SELECT gm.id, 'group' FROM public.group_messages gm JOIN public.chat_groups cg ON cg.id = gm.group_id WHERE gm.created_at BETWEEN _start AND _end AND gm.deleted_at IS NULL AND cg.deleted_at IS NULL AND cg.team_id IS NULL AND cg.mini_league_id IS NULL AND cg.competition_id IS NULL AND (_club_id IS NULL OR cg.id IN (SELECT id FROM club_group_ids))),
  prev_msgs AS (
    SELECT cm.id, 'club'::text AS kind FROM public.club_messages cm WHERE cm.created_at BETWEEN _prev_start AND _prev_end AND cm.deleted_at IS NULL AND (_club_id IS NULL OR cm.club_id = _club_id)
    UNION ALL SELECT gm.id, 'group' FROM public.group_messages gm JOIN public.chat_groups cg ON cg.id = gm.group_id WHERE gm.created_at BETWEEN _prev_start AND _prev_end AND gm.deleted_at IS NULL AND cg.deleted_at IS NULL AND cg.team_id IS NULL AND cg.mini_league_id IS NULL AND cg.competition_id IS NULL AND (_club_id IS NULL OR cg.id IN (SELECT id FROM club_group_ids)))
  SELECT (SELECT COUNT(*) FROM current_msgs),
         (SELECT COUNT(*) FROM public.message_reads mr WHERE mr.user_id = ANY(_members) AND mr.read_at BETWEEN _start AND _end AND (mr.club_message_id IN (SELECT id FROM current_msgs WHERE kind='club') OR mr.group_message_id IN (SELECT id FROM current_msgs WHERE kind='group'))),
         (SELECT COUNT(*) FROM prev_msgs),
         (SELECT COUNT(*) FROM public.message_reads mr WHERE mr.user_id = ANY(_members) AND mr.read_at BETWEEN _prev_start AND _prev_end AND (mr.club_message_id IN (SELECT id FROM prev_msgs WHERE kind='club') OR mr.group_message_id IN (SELECT id FROM prev_msgs WHERE kind='group')))
  INTO _club_msg_total, _club_msg_reads, _prev_club_msg_total, _prev_club_msg_reads;

  -- Team Messages: per-team membership scoping.
  -- A "team member user" for team T = staff/roles on team T + players' profile + guardians of player children.
  WITH club_team_ids AS (SELECT t.id FROM public.teams t WHERE _club_id IS NOT NULL AND t.club_id = _club_id),
  team_user_members AS (
    SELECT DISTINCT u, team_id FROM (
      SELECT ur.user_id AS u, ur.team_id
        FROM public.user_roles ur
       WHERE ur.team_id IS NOT NULL AND ur.user_id IS NOT NULL
         AND (_club_id IS NULL OR ur.team_id IN (SELECT id FROM club_team_ids))
      UNION
      SELECT cp.profile_id AS u, tm.team_id
        FROM public.team_memberships tm
        JOIN public.club_players cp ON cp.id = tm.club_player_id
       WHERE tm.status = 'active' AND cp.profile_id IS NOT NULL
         AND (_club_id IS NULL OR tm.team_id IN (SELECT id FROM club_team_ids))
      UNION
      SELECT cg.guardian_id AS u, tm.team_id
        FROM public.team_memberships tm
        JOIN public.club_players cp ON cp.id = tm.club_player_id
        JOIN public.child_guardians cg ON cg.child_id = cp.child_id
       WHERE tm.status = 'active' AND cp.child_id IS NOT NULL
         AND (_club_id IS NULL OR tm.team_id IN (SELECT id FROM club_team_ids))
    ) s
  ),
  team_member_counts AS (
    SELECT team_id, COUNT(*)::bigint AS member_count FROM team_user_members GROUP BY team_id
  ),
  current_tmsgs AS (
    SELECT tm.id, tm.team_id
      FROM public.team_messages tm
     WHERE tm.created_at BETWEEN _start AND _end AND tm.deleted_at IS NULL
       AND (_club_id IS NULL OR tm.team_id IN (SELECT id FROM club_team_ids))
  ),
  prev_tmsgs AS (
    SELECT tm.id, tm.team_id
      FROM public.team_messages tm
     WHERE tm.created_at BETWEEN _prev_start AND _prev_end AND tm.deleted_at IS NULL
       AND (_club_id IS NULL OR tm.team_id IN (SELECT id FROM club_team_ids))
  )
  SELECT
    (SELECT COUNT(*) FROM current_tmsgs),
    (SELECT COALESCE(SUM(COALESCE(tmc.member_count,0)),0)::bigint
       FROM current_tmsgs ct LEFT JOIN team_member_counts tmc ON tmc.team_id = ct.team_id),
    (SELECT COUNT(*)
       FROM public.message_reads mr
       JOIN current_tmsgs ct ON ct.id = mr.team_message_id
       JOIN team_user_members tum ON tum.team_id = ct.team_id AND tum.u = mr.user_id
      WHERE mr.read_at BETWEEN _start AND _end),
    (SELECT COUNT(*) FROM prev_tmsgs),
    (SELECT COALESCE(SUM(COALESCE(tmc.member_count,0)),0)::bigint
       FROM prev_tmsgs pt LEFT JOIN team_member_counts tmc ON tmc.team_id = pt.team_id),
    (SELECT COUNT(*)
       FROM public.message_reads mr
       JOIN prev_tmsgs pt ON pt.id = mr.team_message_id
       JOIN team_user_members tum ON tum.team_id = pt.team_id AND tum.u = mr.user_id
      WHERE mr.read_at BETWEEN _prev_start AND _prev_end)
  INTO _team_msg_total, _team_msg_possible, _team_msg_reads,
       _prev_team_msg_total, _prev_team_msg_possible, _prev_team_msg_reads;

  IF _club_id IS NULL THEN
    SELECT COUNT(*) INTO _bcast_total FROM public.broadcast_messages bm WHERE bm.created_at BETWEEN _start AND _end AND bm.deleted_at IS NULL;
    SELECT COUNT(*) INTO _bcast_reads FROM public.message_reads mr WHERE mr.user_id = ANY(_members) AND mr.read_at BETWEEN _start AND _end AND mr.broadcast_message_id IN (SELECT bm.id FROM public.broadcast_messages bm WHERE bm.created_at BETWEEN _start AND _end AND bm.deleted_at IS NULL);
    SELECT COUNT(*) INTO _prev_bcast_total FROM public.broadcast_messages bm WHERE bm.created_at BETWEEN _prev_start AND _prev_end AND bm.deleted_at IS NULL;
    SELECT COUNT(*) INTO _prev_bcast_reads FROM public.message_reads mr WHERE mr.user_id = ANY(_members) AND mr.read_at BETWEEN _prev_start AND _prev_end AND mr.broadcast_message_id IN (SELECT bm.id FROM public.broadcast_messages bm WHERE bm.created_at BETWEEN _prev_start AND _prev_end AND bm.deleted_at IS NULL);
  END IF;

  SELECT COUNT(*) INTO _ann_total FROM public.events e LEFT JOIN public.teams t ON t.id = e.team_id WHERE e.created_at BETWEEN _start AND _end AND (_club_id IS NULL OR e.club_id = _club_id OR t.club_id = _club_id);
  SELECT COUNT(*) INTO _ann_views FROM public.event_views ev WHERE ev.user_id = ANY(_members) AND ev.viewed_at BETWEEN _start AND _end AND ev.event_id IN (SELECT e.id FROM public.events e LEFT JOIN public.teams t ON t.id = e.team_id WHERE e.created_at BETWEEN _start AND _end AND (_club_id IS NULL OR e.club_id = _club_id OR t.club_id = _club_id));
  SELECT COUNT(*) INTO _prev_ann_total FROM public.events e LEFT JOIN public.teams t ON t.id = e.team_id WHERE e.created_at BETWEEN _prev_start AND _prev_end AND (_club_id IS NULL OR e.club_id = _club_id OR t.club_id = _club_id);
  SELECT COUNT(*) INTO _prev_ann_views FROM public.event_views ev WHERE ev.user_id = ANY(_members) AND ev.viewed_at BETWEEN _prev_start AND _prev_end AND ev.event_id IN (SELECT e.id FROM public.events e LEFT JOIN public.teams t ON t.id = e.team_id WHERE e.created_at BETWEEN _prev_start AND _prev_end AND (_club_id IS NULL OR e.club_id = _club_id OR t.club_id = _club_id));

  result := jsonb_build_object(
    'total_members', _total, 'active_members', _active_range, 'inactive_members', GREATEST(0, _total - _active_range),
    'dau', _dau, 'wau', _wau, 'mau', _mau, 'prev_wau', _prev_wau, 'prev_mau', _prev_mau,
    'posters', _posters, 'reactors_only', _reactors_only, 'readers_only', _readers_only,
    'inactive_chat', _inactive, 'inactive_msg', _inactive,
    'club_msg_total', _club_msg_total, 'club_msg_reads', _club_msg_reads, 'club_msg_possible', _club_msg_total * GREATEST(_total, 1),
    'prev_club_msg_total', _prev_club_msg_total, 'prev_club_msg_reads', _prev_club_msg_reads, 'prev_club_msg_possible', _prev_club_msg_total * GREATEST(_total, 1),
    'team_msg_total', _team_msg_total, 'team_msg_reads', _team_msg_reads, 'team_msg_possible', _team_msg_possible,
    'prev_team_msg_total', _prev_team_msg_total, 'prev_team_msg_reads', _prev_team_msg_reads, 'prev_team_msg_possible', _prev_team_msg_possible,
    'bcast_total', _bcast_total, 'bcast_reads', _bcast_reads, 'bcast_possible', _bcast_total * GREATEST(_total, 1),
    'prev_bcast_total', _prev_bcast_total, 'prev_bcast_reads', _prev_bcast_reads, 'prev_bcast_possible', _prev_bcast_total * GREATEST(_total, 1),
    'ann_total', _ann_total, 'ann_views', _ann_views, 'ann_possible', _ann_total * GREATEST(_total, 1),
    'prev_ann_total', _prev_ann_total, 'prev_ann_views', _prev_ann_views, 'prev_ann_possible', _prev_ann_total * GREATEST(_total, 1)
  );
  RETURN result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.club_engagement_benchmarks(uuid, timestamptz, timestamptz, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.club_engagement_benchmarks(uuid, timestamptz, timestamptz, timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.club_engagement_benchmarks(uuid, timestamptz, timestamptz, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.club_engagement_benchmarks(uuid, timestamptz, timestamptz, timestamptz, timestamptz) TO service_role;