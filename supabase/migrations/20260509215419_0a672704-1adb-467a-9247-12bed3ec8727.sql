
INSERT INTO public.app_settings (key, value, description)
VALUES (
  'chat_photo_gallery_reminders',
  '{"enabled": true, "window_start_hours": 24, "window_end_hours": 48, "cooldown_days": 7}'::jsonb,
  'Controls hourly chat-photo gallery reminder cron: enabled flag, scan window (hours ago) and per-author cooldown in days.'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.post_chat_photo_gallery_reminder(_team_id uuid, _author_id uuid, _system_user_id uuid, _photo_count integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_message_id UUID;
  v_text TEXT;
  v_author_first TEXT;
  v_cooldown_days INT := 7;
  v_settings JSONB;
BEGIN
  IF _photo_count <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT value INTO v_settings FROM public.app_settings WHERE key = 'chat_photo_gallery_reminders';
  IF v_settings IS NOT NULL THEN
    BEGIN
      v_cooldown_days := COALESCE((v_settings->>'cooldown_days')::int, 7);
    EXCEPTION WHEN OTHERS THEN
      v_cooldown_days := 7;
    END;
  END IF;
  IF v_cooldown_days < 1 THEN v_cooldown_days := 1; END IF;

  IF EXISTS (
    SELECT 1 FROM public.chat_photo_gallery_reminders
    WHERE team_id = _team_id
      AND author_id = _author_id
      AND created_at > now() - (v_cooldown_days || ' days')::interval
  ) THEN
    RETURN NULL;
  END IF;

  SELECT split_part(COALESCE(NULLIF(full_name, ''), 'You'), ' ', 1)
    INTO v_author_first
  FROM public.profiles
  WHERE id = _author_id;

  v_text := '📸 ' || COALESCE(v_author_first, 'You') ||
            CASE WHEN _photo_count = 1
              THEN ' shared a photo in chat — long-press it to add it to the team gallery so it doesn''t get lost.'
              ELSE ' shared ' || _photo_count::text || ' photos in chat — long-press any of them to add them to the team gallery so they don''t get lost.'
            END;

  INSERT INTO public.team_messages(team_id, author_id, text, is_system_message)
  VALUES (_team_id, _system_user_id, v_text, true)
  RETURNING id INTO v_message_id;

  INSERT INTO public.chat_photo_gallery_reminders(team_id, author_id, message_id, photo_count)
  VALUES (_team_id, _author_id, v_message_id, _photo_count);

  RETURN v_message_id;
END;
$function$;
