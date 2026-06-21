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
    (
      (SELECT COUNT(*)::bigint FROM public.association_broadcasts ab
         WHERE _club_id = ANY(ab.club_ids)
           AND ab.created_at >= _start AND ab.created_at <= _end)
      +
      (SELECT COUNT(*)::bigint FROM public.competition_broadcasts cb
         WHERE EXISTS (
           SELECT 1 FROM public.competition_entries ce
           JOIN public.teams te ON te.id = ce.team_id
           WHERE ce.competition_id = cb.competition_id
             AND te.club_id = _club_id
         )
         AND cb.created_at >= _start AND cb.created_at <= _end)
    ),
    (SELECT COUNT(*)::bigint FROM public.events e
       JOIN public.teams te ON te.id = e.team_id
       WHERE te.club_id = _club_id
         AND e.is_cancelled = false
         AND e.type IN ('game','training')
         AND e.start_time >= _start AND e.start_time <= _end),
    (SELECT COUNT(*)::bigint FROM public.rsvps r
       JOIN public.events e ON e.id = r.event_id
       JOIN public.teams te ON te.id = e.team_id
       WHERE te.club_id = _club_id
         AND e.is_cancelled = false
         AND e.type IN ('game','training')
         AND e.start_time >= _start AND e.start_time <= _end),
    (SELECT COUNT(*)::bigint FROM public.rsvps r
       JOIN public.events e ON e.id = r.event_id
       JOIN public.teams te ON te.id = e.team_id
       WHERE te.club_id = _club_id
         AND e.is_cancelled = false
         AND e.type IN ('game','training')
         AND e.start_time >= _start AND e.start_time <= _end
         AND r.status IS NOT NULL AND r.status <> 'pending'),
    (SELECT COUNT(*)::bigint FROM public.rsvps r
       JOIN public.events e ON e.id = r.event_id
       JOIN public.teams te ON te.id = e.team_id
       WHERE te.club_id = _club_id
         AND e.is_cancelled = false
         AND e.type IN ('game','training')
         AND e.start_time >= _start AND e.start_time <= _end
         AND r.status = 'going'),
    (SELECT COUNT(*)::bigint FROM public.photos p
       WHERE p.club_id = _club_id AND p.deleted_at IS NULL
         AND p.created_at >= _start AND p.created_at <= _end);
END;
$$;