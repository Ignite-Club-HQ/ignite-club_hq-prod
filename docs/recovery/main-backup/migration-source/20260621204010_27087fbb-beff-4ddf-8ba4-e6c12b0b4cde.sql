CREATE OR REPLACE FUNCTION public.club_engagement_totals(_club_id uuid, _start timestamp with time zone, _end timestamp with time zone)
 RETURNS TABLE(club_msgs bigint, team_msgs bigint, reactions bigint, broadcasts bigint, events bigint, rsvps_total bigint, rsvps_responded bigint, rsvps_going bigint, photos_uploaded bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _club_id IS NULL THEN
    IF NOT has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;

    RETURN QUERY
    WITH ev AS (
      SELECT e.id, e.team_id
      FROM public.events e
      WHERE COALESCE(e.is_cancelled, false) = false
        AND e.type IN ('game','training')
        AND e.start_time >= _start
        AND e.start_time <= _end
    ),
    roster AS (
      SELECT ev.id AS event_id,
             COALESCE((SELECT COUNT(*) FROM public.child_team_assignments cta WHERE cta.team_id = ev.team_id), 0)
           + COALESCE((SELECT COUNT(*) FROM public.club_players cp
                        JOIN public.teams t ON t.id = ev.team_id
                       WHERE cp.club_id = t.club_id AND cp.is_active AND cp.profile_id IS NOT NULL AND cp.child_id IS NULL), 0)
             AS expected
      FROM ev
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
      (SELECT COUNT(*)::bigint FROM ev),
      COALESCE((SELECT SUM(expected)::bigint FROM roster), 0),
      (SELECT COUNT(*)::bigint FROM public.rsvps r WHERE r.event_id IN (SELECT id FROM ev) AND r.status IS NOT NULL),
      (SELECT COUNT(*)::bigint FROM public.rsvps r WHERE r.event_id IN (SELECT id FROM ev) AND r.status = 'going'),
      (SELECT COUNT(*)::bigint FROM public.photos p
         WHERE p.deleted_at IS NULL AND p.created_at >= _start AND p.created_at <= _end);
    RETURN;
  END IF;

  IF NOT (
    has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
    OR has_role(auth.uid(), 'club_admin'::app_role, _club_id, NULL::uuid)
    OR has_role(auth.uid(), 'committee_member'::app_role, _club_id, NULL::uuid)
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  WITH club_team_ids AS (
    SELECT t.id FROM public.teams t WHERE t.club_id = _club_id
  ),
  club_event_ids AS (
    SELECT e.id, e.team_id
    FROM public.events e
    LEFT JOIN public.teams te ON te.id = e.team_id
    WHERE COALESCE(e.is_cancelled, false) = false
      AND e.type IN ('game','training')
      AND e.start_time >= _start
      AND e.start_time <= _end
      AND (e.club_id = _club_id OR te.club_id = _club_id)
  ),
  roster AS (
    SELECT ce.id AS event_id,
           COALESCE((SELECT COUNT(*) FROM public.child_team_assignments cta WHERE cta.team_id = ce.team_id), 0)
         + COALESCE((SELECT COUNT(*) FROM public.club_players cp
                      WHERE cp.club_id = _club_id AND cp.is_active AND cp.profile_id IS NOT NULL AND cp.child_id IS NULL), 0)
           AS expected
    FROM club_event_ids ce
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
       WHERE mr.created_at >= _start AND mr.created_at <= _end
         AND (
           mr.club_message_id IN (SELECT id FROM public.club_messages WHERE club_id = _club_id)
           OR mr.team_message_id IN (SELECT id FROM public.team_messages WHERE team_id IN (SELECT id FROM club_team_ids))
           OR mr.group_message_id IN (SELECT id FROM public.group_messages WHERE group_id IN (SELECT id FROM club_group_ids))
           OR mr.club_admin_message_id IN (SELECT id FROM public.club_admin_messages WHERE conversation_id IN (SELECT id FROM club_admin_conversation_ids))
         )),
    0::bigint,
    (SELECT COUNT(*)::bigint FROM club_event_ids),
    COALESCE((SELECT SUM(expected)::bigint FROM roster), 0),
    (SELECT COUNT(*)::bigint FROM public.rsvps r WHERE r.event_id IN (SELECT id FROM club_event_ids) AND r.status IS NOT NULL),
    (SELECT COUNT(*)::bigint FROM public.rsvps r WHERE r.event_id IN (SELECT id FROM club_event_ids) AND r.status = 'going'),
    (SELECT COUNT(*)::bigint FROM public.photos p
       WHERE p.club_id = _club_id AND p.deleted_at IS NULL
         AND p.created_at >= _start AND p.created_at <= _end);
  RETURN;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.club_engagement_totals(uuid, timestamp with time zone, timestamp with time zone) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.club_engagement_totals(uuid, timestamp with time zone, timestamp with time zone) FROM anon;
GRANT EXECUTE ON FUNCTION public.club_engagement_totals(uuid, timestamp with time zone, timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.club_engagement_totals(uuid, timestamp with time zone, timestamp with time zone) TO service_role;