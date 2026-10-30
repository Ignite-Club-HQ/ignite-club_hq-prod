
-- Helper: returns true when the team (or its parent club) has an active Pro entitlement.
CREATE OR REPLACE FUNCTION public.is_team_or_club_pro(_team_id uuid, _club_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id uuid := _club_id;
  v_is_pro boolean := false;
BEGIN
  IF v_club_id IS NULL AND _team_id IS NOT NULL THEN
    SELECT club_id INTO v_club_id FROM public.teams WHERE id = _team_id;
  END IF;

  IF _team_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.team_subscriptions ts
      WHERE ts.team_id = _team_id
        AND (ts.is_pro = true OR ts.is_pro_football = true
             OR ts.admin_pro_override = true OR ts.admin_pro_football_override = true)
        AND (ts.expires_at IS NULL OR ts.expires_at > now())
    ) INTO v_is_pro;
    IF v_is_pro THEN RETURN true; END IF;
  END IF;

  IF v_club_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.club_subscriptions cs
      WHERE cs.club_id = v_club_id
        AND (cs.is_pro = true OR cs.is_pro_football = true
             OR cs.admin_pro_override = true OR cs.admin_pro_football_override = true)
        AND (cs.expires_at IS NULL OR cs.expires_at > now())
    ) INTO v_is_pro;
    IF v_is_pro THEN RETURN true; END IF;
  END IF;

  RETURN false;
END;
$$;

-- Photo upload: gate notifications + emails on Pro entitlement.
CREATE OR REPLACE FUNCTION public.on_photo_uploaded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uploader_name text;
  team_name text;
  club_name text;
  notification_message text;
  member_user_id uuid;
BEGIN
  IF NEW.show_in_feed IS DISTINCT FROM TRUE THEN
    RETURN NEW;
  END IF;

  -- Pro gate: skip all notifications/emails unless the team or club is Pro.
  IF NOT public.is_team_or_club_pro(NEW.team_id, NEW.club_id) THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO uploader_name FROM public.profiles WHERE id = NEW.uploader_id;

  IF NEW.team_id IS NOT NULL THEN
    SELECT name INTO team_name FROM public.teams WHERE id = NEW.team_id;
    notification_message := COALESCE(uploader_name, 'Someone') || ' uploaded a new photo to ' || COALESCE(team_name, 'your team');

    FOR member_user_id IN
      SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
      WHERE ur.team_id = NEW.team_id
        AND ur.user_id != NEW.uploader_id
    LOOP
      INSERT INTO public.notifications (user_id, type, message, related_id)
      VALUES (member_user_id, 'photo_uploaded', notification_message, NEW.id)
      ON CONFLICT DO NOTHING;

      PERFORM public.send_photo_notification_email(
        member_user_id, NEW.uploader_id, NEW.id, 'team', NEW.team_id, team_name
      );
    END LOOP;

  ELSIF NEW.club_id IS NOT NULL THEN
    SELECT name INTO club_name FROM public.clubs WHERE id = NEW.club_id;
    notification_message := COALESCE(uploader_name, 'Someone') || ' uploaded a new photo to ' || COALESCE(club_name, 'your club');

    FOR member_user_id IN
      SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
      WHERE ur.club_id = NEW.club_id
        AND ur.user_id != NEW.uploader_id
    LOOP
      INSERT INTO public.notifications (user_id, type, message, related_id)
      VALUES (member_user_id, 'photo_uploaded', notification_message, NEW.id)
      ON CONFLICT DO NOTHING;

      PERFORM public.send_photo_notification_email(
        member_user_id, NEW.uploader_id, NEW.id, 'club', NEW.club_id, club_name
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

-- Photo comment notifications: gate on Pro entitlement of the photo's team/club.
CREATE OR REPLACE FUNCTION public.on_photo_comment_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  commenter_name text;
  photo_record RECORD;
  original_comment_author_id uuid;
  team_name text;
  club_name text;
  notification_message text;
BEGIN
  SELECT display_name INTO commenter_name FROM public.profiles WHERE id = NEW.user_id;
  SELECT * INTO photo_record FROM public.photos WHERE id = NEW.photo_id;

  IF public.is_team_or_club_pro(photo_record.team_id, photo_record.club_id) THEN
    IF photo_record.team_id IS NOT NULL THEN
      SELECT name INTO team_name FROM public.teams WHERE id = photo_record.team_id;
      notification_message := COALESCE(commenter_name, 'Someone') || ' commented on a photo in ' || COALESCE(team_name, 'your team');
      PERFORM public.notify_team_members(photo_record.team_id, NEW.user_id, 'photo_comment', notification_message, NEW.photo_id);
    ELSIF photo_record.club_id IS NOT NULL THEN
      SELECT name INTO club_name FROM public.clubs WHERE id = photo_record.club_id;
      notification_message := COALESCE(commenter_name, 'Someone') || ' commented on a photo in ' || COALESCE(club_name, 'your club');
      PERFORM public.notify_club_members(photo_record.club_id, NEW.user_id, 'photo_comment', notification_message, NEW.photo_id);
    END IF;

    IF NEW.reply_to_id IS NOT NULL THEN
      SELECT user_id INTO original_comment_author_id FROM public.photo_comments WHERE id = NEW.reply_to_id;
      IF original_comment_author_id IS NOT NULL AND original_comment_author_id != NEW.user_id THEN
        INSERT INTO public.notifications (user_id, type, message, related_id)
        VALUES (original_comment_author_id, 'comment_reply', COALESCE(commenter_name, 'Someone') || ' replied to your comment', NEW.photo_id);
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Photo reaction notifications: gate on Pro entitlement of the photo's team/club.
CREATE OR REPLACE FUNCTION public.on_photo_reaction_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  reactor_name text;
  photo_record RECORD;
BEGIN
  SELECT * INTO photo_record FROM public.photos WHERE id = NEW.photo_id;

  IF NOT public.is_team_or_club_pro(photo_record.team_id, photo_record.club_id) THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO reactor_name FROM public.profiles WHERE id = NEW.user_id;

  IF photo_record.uploader_id IS NOT NULL AND photo_record.uploader_id != NEW.user_id THEN
    INSERT INTO public.notifications (user_id, type, message, related_id)
    VALUES (photo_record.uploader_id, 'photo_reaction',
      COALESCE(reactor_name, 'Someone') || ' reacted ' || NEW.reaction_type || ' to your photo', NEW.photo_id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

-- Post-game gallery prompt card: only for Pro teams.
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
  IF NOT public.is_team_or_club_pro(_team_id, NULL) THEN
    RETURN NULL;
  END IF;

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

  IF EXISTS (
    SELECT 1 FROM public.gallery_chat_cards
    WHERE team_id = _team_id AND is_prompt = true
      AND created_at > now() - (v_cooldown_days || ' days')::interval
  ) THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.photos WHERE event_id = _event_id AND deleted_at IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  v_card_id := gen_random_uuid();
  v_message_text := '[galleryprompt:' || v_card_id || ']';

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

-- Chat photo gallery reminder: only for Pro teams.
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

  IF NOT public.is_team_or_club_pro(_team_id, NULL) THEN
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
  IF v_cooldown_days < 7 THEN v_cooldown_days := 7; END IF;

  IF EXISTS (
    SELECT 1 FROM public.chat_photo_gallery_reminders
    WHERE team_id = _team_id
      AND created_at > now() - (v_cooldown_days || ' days')::interval
  ) THEN
    RETURN NULL;
  END IF;

  SELECT split_part(COALESCE(NULLIF(full_name, ''), 'You'), ' ', 1)
    INTO v_author_first
  FROM public.profiles WHERE id = _author_id;

  v_text := '📸 ' || COALESCE(v_author_first, 'You') ||
            CASE WHEN _photo_count = 1
              THEN ' shared a photo in chat — tap below to add it to the team gallery so it doesn''t get lost.'
              ELSE ' shared ' || _photo_count::text || ' photos in chat — tap below to add them to the team gallery so they don''t get lost.'
            END
            || E'\n[publish:' || _team_id::text || ']';

  INSERT INTO public.team_messages(team_id, author_id, text, is_system_message)
  VALUES (_team_id, _system_user_id, v_text, true)
  RETURNING id INTO v_message_id;

  INSERT INTO public.chat_photo_gallery_reminders(team_id, author_id, message_id, photo_count)
  VALUES (_team_id, _author_id, v_message_id, _photo_count);

  RETURN v_message_id;
END;
$function$;
