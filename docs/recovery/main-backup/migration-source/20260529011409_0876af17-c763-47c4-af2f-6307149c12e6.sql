CREATE OR REPLACE FUNCTION public.mark_chat_scope_notifications_read(
  _user_id uuid,
  _scope_kind text,
  _scope_id uuid DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _affected int := 0;
  _scope_table text;
  _scope_col text;
  _primary_type text;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF _scope_kind = 'broadcast' THEN
    UPDATE public.notifications
       SET is_read = true
     WHERE user_id = _user_id
       AND is_read = false
       AND type = 'broadcast';
    GET DIAGNOSTICS _affected = ROW_COUNT;
    RETURN _affected;
  END IF;

  IF _scope_id IS NULL THEN
    RAISE EXCEPTION 'scope_id required for scope kind %', _scope_kind;
  END IF;

  IF _scope_kind = 'team' THEN
    _scope_table := 'team_messages';   _scope_col := 'team_id';
    _primary_type := 'team_message';
  ELSIF _scope_kind = 'club' THEN
    _scope_table := 'club_messages';   _scope_col := 'club_id';
    _primary_type := 'club_message';
  ELSIF _scope_kind = 'group' THEN
    _scope_table := 'group_messages';  _scope_col := 'group_id';
    _primary_type := 'group_message';
  ELSIF _scope_kind = 'dm' THEN
    -- DM notifications use related_id = conversation_id directly.
    UPDATE public.notifications
       SET is_read = true
     WHERE user_id = _user_id
       AND is_read = false
       AND type = 'direct_message'
       AND related_id = _scope_id;
    GET DIAGNOSTICS _affected = ROW_COUNT;
    RETURN _affected;
  ELSE
    RAISE EXCEPTION 'unsupported scope kind %', _scope_kind;
  END IF;

  -- Primary thread type + reply/mention/reaction/forward whose related message
  -- belongs to this scope. related_id is the message id (NOT the team/club/
  -- group id), so we must resolve via the scope's messages table.
  EXECUTE format($f$
    WITH scoped_msgs AS (
      SELECT id FROM public.%I WHERE %I = $1
    )
    UPDATE public.notifications n
       SET is_read = true
      FROM scoped_msgs s
     WHERE n.user_id = $2
       AND n.is_read = false
       AND n.related_id = s.id
       AND n.type IN ($3, 'message_reply', 'message_mention', 'message_reaction', 'message_forwarded')
  $f$, _scope_table, _scope_col)
  USING _scope_id, _user_id, _primary_type;

  GET DIAGNOSTICS _affected = ROW_COUNT;
  RETURN _affected;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_chat_scope_notifications_read(uuid, text, uuid) TO authenticated;