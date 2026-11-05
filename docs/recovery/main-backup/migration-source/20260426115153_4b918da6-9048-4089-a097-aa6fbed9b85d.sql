-- Server-side read receipt writer: uses auth.uid() and ignores duplicates without raising errors.
CREATE OR REPLACE FUNCTION public.mark_message_reads(
  _message_type text,
  _message_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
BEGIN
  IF _user_id IS NULL OR _message_ids IS NULL OR array_length(_message_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  CASE _message_type
    WHEN 'team' THEN
      INSERT INTO public.message_reads (user_id, team_message_id)
      SELECT _user_id, unnest(_message_ids)
      ON CONFLICT DO NOTHING;
    WHEN 'club' THEN
      INSERT INTO public.message_reads (user_id, club_message_id)
      SELECT _user_id, unnest(_message_ids)
      ON CONFLICT DO NOTHING;
    WHEN 'group' THEN
      INSERT INTO public.message_reads (user_id, group_message_id)
      SELECT _user_id, unnest(_message_ids)
      ON CONFLICT DO NOTHING;
    WHEN 'broadcast' THEN
      INSERT INTO public.message_reads (user_id, broadcast_message_id)
      SELECT _user_id, unnest(_message_ids)
      ON CONFLICT DO NOTHING;
    WHEN 'dm' THEN
      INSERT INTO public.message_reads (user_id, direct_message_id)
      SELECT _user_id, unnest(_message_ids)
      ON CONFLICT DO NOTHING;
    WHEN 'club_admin' THEN
      INSERT INTO public.message_reads (user_id, club_admin_message_id)
      SELECT _user_id, unnest(_message_ids)
      ON CONFLICT DO NOTHING;
    ELSE
      RAISE EXCEPTION 'Unsupported message type: %', _message_type;
  END CASE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_message_reads(text, uuid[]) TO authenticated;

-- Server-side activity tracking: never trusts a client-provided user_id.
CREATE OR REPLACE FUNCTION public.track_user_activity_start(
  _page_path text,
  _page_label text,
  _session_id text,
  _club_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _log_id uuid;
BEGIN
  IF _user_id IS NULL OR _page_path IS NULL OR _session_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.user_activity_logs (
    user_id,
    page_path,
    page_label,
    session_id,
    club_id,
    duration_seconds
  ) VALUES (
    _user_id,
    _page_path,
    _page_label,
    _session_id,
    _club_id,
    0
  )
  RETURNING id INTO _log_id;

  RETURN _log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.track_user_activity_start(text, text, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_user_activity_duration(
  _activity_log_id uuid,
  _duration_seconds integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
BEGIN
  IF _user_id IS NULL OR _activity_log_id IS NULL OR _duration_seconds IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.user_activity_logs
  SET duration_seconds = GREATEST(_duration_seconds, 0)
  WHERE id = _activity_log_id
    AND user_id = _user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_user_activity_duration(uuid, integer) TO authenticated;