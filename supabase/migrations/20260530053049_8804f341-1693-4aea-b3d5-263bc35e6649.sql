CREATE OR REPLACE FUNCTION public.get_unread_message_counts(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  _result jsonb;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  WITH n AS MATERIALIZED (
    SELECT type, related_id
    FROM public.notifications
    WHERE user_id = _user_id
      AND is_read = false
      AND type IN (
        'team_message','club_message','group_message','broadcast',
        'message_reply','message_mention','direct_message'
      )
  ),
  broadcast AS (
    SELECT count(*)::int AS c FROM n WHERE type = 'broadcast'
  ),
  teams AS (
    SELECT COALESCE(jsonb_object_agg(team_id::text, cnt), '{}'::jsonb) AS j
    FROM (
      SELECT tm.team_id, count(*)::int AS cnt
      FROM n
      JOIN public.team_messages tm ON tm.id = n.related_id
      WHERE n.type = 'team_message' AND tm.team_id IS NOT NULL
      GROUP BY tm.team_id
    ) x
  ),
  clubs AS (
    SELECT COALESCE(jsonb_object_agg(club_id::text, cnt), '{}'::jsonb) AS j
    FROM (
      SELECT cm.club_id, count(*)::int AS cnt
      FROM n
      JOIN public.club_messages cm ON cm.id = n.related_id
      WHERE n.type = 'club_message' AND cm.club_id IS NOT NULL
      GROUP BY cm.club_id
    ) x
  ),
  grps AS (
    SELECT COALESCE(jsonb_object_agg(group_id::text, cnt), '{}'::jsonb) AS j
    FROM (
      SELECT gm.group_id, count(*)::int AS cnt
      FROM n
      JOIN public.group_messages gm ON gm.id = n.related_id
      WHERE n.type = 'group_message' AND gm.group_id IS NOT NULL
      GROUP BY gm.group_id
    ) x
  ),
  dm_raw AS (
    SELECT related_id AS conversation_id, count(*)::int AS cnt
    FROM n
    WHERE type = 'direct_message' AND related_id IS NOT NULL
    GROUP BY related_id
  ),
  dms AS (
    SELECT COALESCE(jsonb_object_agg(conversation_id::text, cnt), '{}'::jsonb) AS j
    FROM dm_raw d
    WHERE (
      SELECT dm.author_id
      FROM public.direct_messages dm
      WHERE dm.conversation_id = d.conversation_id
      ORDER BY dm.created_at DESC
      LIMIT 1
    ) <> _user_id
  )
  SELECT jsonb_build_object(
    'broadcast', (SELECT c FROM broadcast),
    'teams',     (SELECT j FROM teams),
    'clubs',     (SELECT j FROM clubs),
    'groups',    (SELECT j FROM grps),
    'dms',       (SELECT j FROM dms)
  )
  INTO _result;

  RETURN _result;
END;
$function$;