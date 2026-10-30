
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread_type
  ON public.notifications (user_id, is_read, type)
  WHERE is_read = false;

CREATE OR REPLACE FUNCTION public.get_unread_message_counts(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _broadcast int := 0;
  _teams jsonb := '{}'::jsonb;
  _clubs jsonb := '{}'::jsonb;
  _groups jsonb := '{}'::jsonb;
  _dms jsonb := '{}'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  WITH n AS (
    SELECT type, related_id
    FROM public.notifications
    WHERE user_id = _user_id
      AND is_read = false
      AND type IN (
        'team_message','club_message','group_message','broadcast',
        'message_reply','message_mention','direct_message'
      )
  )
  SELECT COUNT(*)::int INTO _broadcast FROM n WHERE type = 'broadcast';

  SELECT COALESCE(jsonb_object_agg(team_id::text, cnt), '{}'::jsonb)
  INTO _teams
  FROM (
    SELECT tm.team_id, COUNT(*)::int AS cnt
    FROM public.notifications nt
    JOIN public.team_messages tm ON tm.id = nt.related_id
    WHERE nt.user_id = _user_id AND nt.is_read = false AND nt.type = 'team_message'
      AND tm.team_id IS NOT NULL
    GROUP BY tm.team_id
  ) t;

  SELECT COALESCE(jsonb_object_agg(club_id::text, cnt), '{}'::jsonb)
  INTO _clubs
  FROM (
    SELECT cm.club_id, COUNT(*)::int AS cnt
    FROM public.notifications nt
    JOIN public.club_messages cm ON cm.id = nt.related_id
    WHERE nt.user_id = _user_id AND nt.is_read = false AND nt.type = 'club_message'
      AND cm.club_id IS NOT NULL
    GROUP BY cm.club_id
  ) c;

  SELECT COALESCE(jsonb_object_agg(group_id::text, cnt), '{}'::jsonb)
  INTO _groups
  FROM (
    SELECT gm.group_id, COUNT(*)::int AS cnt
    FROM public.notifications nt
    JOIN public.group_messages gm ON gm.id = nt.related_id
    WHERE nt.user_id = _user_id AND nt.is_read = false AND nt.type = 'group_message'
      AND gm.group_id IS NOT NULL
    GROUP BY gm.group_id
  ) g;

  SELECT COALESCE(jsonb_object_agg(conversation_id::text, cnt), '{}'::jsonb)
  INTO _dms
  FROM (
    SELECT d.related_id AS conversation_id, d.cnt
    FROM (
      SELECT related_id, COUNT(*)::int AS cnt
      FROM public.notifications
      WHERE user_id = _user_id AND is_read = false AND type = 'direct_message'
        AND related_id IS NOT NULL
      GROUP BY related_id
    ) d
    JOIN LATERAL (
      SELECT author_id
      FROM public.direct_messages dm
      WHERE dm.conversation_id = d.related_id
      ORDER BY dm.created_at DESC
      LIMIT 1
    ) latest ON true
    WHERE latest.author_id <> _user_id
  ) dms;

  RETURN jsonb_build_object(
    'broadcast', _broadcast,
    'teams', _teams,
    'clubs', _clubs,
    'groups', _groups,
    'dms', _dms
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_unread_message_counts(uuid) TO authenticated;
