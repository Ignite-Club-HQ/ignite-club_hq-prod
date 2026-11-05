
CREATE OR REPLACE FUNCTION public.post_team_gallery_prompt(
  _team_id UUID,
  _event_id UUID,
  _system_user_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card_id UUID;
  v_message_id UUID;
  v_message_text TEXT;
BEGIN
  -- Skip if a prompt already exists for this team+event in last 24h.
  IF EXISTS (
    SELECT 1 FROM public.gallery_chat_cards
    WHERE team_id = _team_id
      AND event_id = _event_id
      AND is_prompt = true
      AND created_at > now() - INTERVAL '24 hours'
  ) THEN
    RETURN NULL;
  END IF;

  -- Skip if any photos already uploaded for this event.
  IF EXISTS (
    SELECT 1 FROM public.photos
    WHERE event_id = _event_id AND deleted_at IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  v_card_id := gen_random_uuid();
  v_message_text := '[gallery:' || v_card_id || ']';

  INSERT INTO public.team_messages(team_id, author_id, text, is_system_message)
  VALUES (_team_id, _system_user_id, v_message_text, true)
  RETURNING id INTO v_message_id;

  INSERT INTO public.gallery_chat_cards(
    id, team_id, uploader_id, message_id, event_id,
    photo_ids, photo_count, is_prompt
  ) VALUES (
    v_card_id, _team_id, _system_user_id, v_message_id, _event_id,
    ARRAY[]::UUID[], 0, true
  );

  RETURN v_card_id;
END;
$$;

REVOKE ALL ON FUNCTION public.post_team_gallery_prompt(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_team_gallery_prompt(UUID, UUID, UUID) TO service_role;
