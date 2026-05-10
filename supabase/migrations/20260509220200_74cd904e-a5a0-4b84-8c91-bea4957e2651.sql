
INSERT INTO public.app_settings (key, value, description)
VALUES (
  'post_game_gallery_prompts',
  '{"enabled": true, "cooldown_days": 7}'::jsonb,
  'Controls the post-game "Got photos from..." chat prompt: enabled flag and per-team cooldown in days (default 7 = max once per week).'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.post_team_gallery_prompt(_team_id uuid, _event_id uuid, _system_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_card_id UUID;
  v_message_id UUID;
  v_message_text TEXT;
  v_cooldown_days INT := 7;
  v_settings JSONB;
  v_enabled BOOLEAN := TRUE;
BEGIN
  SELECT value INTO v_settings FROM public.app_settings WHERE key = 'post_game_gallery_prompts';
  IF v_settings IS NOT NULL THEN
    BEGIN
      v_cooldown_days := COALESCE((v_settings->>'cooldown_days')::int, 7);
      IF (v_settings->>'enabled') IS NOT NULL THEN
        v_enabled := (v_settings->>'enabled')::boolean;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_cooldown_days := 7;
      v_enabled := TRUE;
    END;
  END IF;
  IF NOT v_enabled THEN RETURN NULL; END IF;
  IF v_cooldown_days < 1 THEN v_cooldown_days := 1; END IF;

  -- Skip if any prompt for THIS team posted within the cooldown window
  -- (regardless of event), so members see at most one nudge per period.
  IF EXISTS (
    SELECT 1 FROM public.gallery_chat_cards
    WHERE team_id = _team_id
      AND is_prompt = true
      AND created_at > now() - (v_cooldown_days || ' days')::interval
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
$function$;
