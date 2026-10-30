CREATE OR REPLACE FUNCTION public.on_direct_message_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  sender_name text;
  recipient_id uuid;
  conversation_record record;
  has_image boolean;
  notification_url text;
  notification_id uuid;
  request_id bigint;
BEGIN
  SELECT display_name INTO sender_name FROM public.profiles WHERE id = NEW.author_id;
  has_image := NEW.image_url IS NOT NULL AND NEW.image_url != '';

  SELECT * INTO conversation_record FROM public.direct_conversations WHERE id = NEW.conversation_id;

  IF conversation_record.participant_1 = NEW.author_id THEN
    recipient_id := conversation_record.participant_2;
  ELSE
    recipient_id := conversation_record.participant_1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.chat_mute_preferences cmp
    WHERE cmp.user_id = recipient_id 
    AND cmp.chat_id = NEW.conversation_id
    AND cmp.chat_type = 'dm'
    AND (cmp.muted_until IS NULL OR cmp.muted_until > now())
  ) THEN
    -- Store the exact message id in related_id. Older rows used the conversation
    -- id, so read/count helpers below support both shapes during migration.
    INSERT INTO public.notifications (user_id, type, message, related_id, skip_push)
    VALUES (
      recipient_id, 
      'direct_message', 
      COALESCE(sender_name, 'Someone') || ' sent you a message',
      NEW.id,
      true
    )
    RETURNING id INTO notification_id;

    notification_url := '/messages/dm/' || NEW.conversation_id::text || '?message=' || NEW.id::text;

    BEGIN
      SELECT net.http_post(
        url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/send-push-notification',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1RupohNEQmQ_3MeHFFn8zDXhLM4as'
        ),
        body := jsonb_build_object(
          'userId', recipient_id::text,
          'title', 'Ignite — Messages',
          'body', COALESCE(sender_name, 'Someone') || ' sent you a message',
          'url', notification_url,
          'notificationId', notification_id::text,
          'tag', 'direct_message-' || notification_id::text,
          'notificationType', 'direct_message',
          'data', jsonb_build_object(
            'notificationType', 'direct_message',
            'type', 'direct_message',
            'category', 'messages',
            'message_id', NEW.id::text,
            'related_id', NEW.id::text,
            'conversation_id', NEW.conversation_id::text,
            'author_id', NEW.author_id::text,
            'created_at', NEW.created_at::text,
            'text', NEW.text
          )
        )
      ) INTO request_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'DM push dispatch failed for message %: %', NEW.id, SQLERRM;
    END;

    PERFORM public.send_message_notification_email(
      recipient_id,
      NEW.author_id,
      NEW.text,
      'direct',
      NEW.conversation_id,
      NULL,
      NEW.id,
      has_image
    );
  END IF;

  RETURN NEW;
END;
$function$;

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
    SELECT COALESCE(dm.conversation_id, n.related_id) AS conversation_id, count(*)::int AS cnt
    FROM n
    LEFT JOIN public.direct_messages dm ON dm.id = n.related_id
    WHERE n.type = 'direct_message' AND n.related_id IS NOT NULL
    GROUP BY COALESCE(dm.conversation_id, n.related_id)
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

CREATE OR REPLACE FUNCTION public.mark_chat_scope_notifications_read(_user_id uuid, _scope_kind text, _scope_id uuid DEFAULT NULL::uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
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
    UPDATE public.notifications n
       SET is_read = true
     WHERE n.user_id = _user_id
       AND n.is_read = false
       AND n.type = 'direct_message'
       AND (
         n.related_id = _scope_id
         OR EXISTS (
           SELECT 1
           FROM public.direct_messages dm
           WHERE dm.id = n.related_id
             AND dm.conversation_id = _scope_id
         )
       );
    GET DIAGNOSTICS _affected = ROW_COUNT;
    RETURN _affected;
  ELSE
    RAISE EXCEPTION 'unsupported scope kind %', _scope_kind;
  END IF;

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
$function$;

CREATE OR REPLACE FUNCTION public.send_push_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  notification_url text;
  notification_tag text;
  category text;
  should_send boolean := true;
  prefs RECORD;
  request_id bigint;
  msg_id text;
  team_id_val uuid;
  club_id_val uuid;
  group_id_val uuid;
  conv_id_val uuid;
  direct_msg_id_val uuid;
  photo_team_id uuid;
  photo_club_id uuid;
  game_team_id uuid;
  notification_title text;
BEGIN
  IF NEW.skip_push = true THEN
    RETURN NEW;
  END IF;

  CASE
    WHEN NEW.type IN ('team_message','club_message','group_message','broadcast','message_reply','message_reaction','message_mention','direct_message','message_forwarded') THEN
      category := 'messages';
    WHEN NEW.type IN ('event_invite','event_cancelled','event_reminder','event_view_reminder','event_updated','rsvp_reminder','rsvp_updated','duty_assigned','rsvp') THEN
      category := 'events';
    WHEN NEW.type IN ('photo_uploaded','photo_reaction','photo_comment','comment_reaction','comment_reply') THEN
      category := 'media';
    WHEN NEW.type IN ('membership','join_request','join_request_approved','join_request_denied','join_request_processed','role_assigned','role_removed','team_invite','team_join','club_join','member_joined','invite_accepted') THEN
      category := 'membership';
    WHEN NEW.type IN ('pitch_board','pitch_board_update','substitution','substitution_alert','game_finished','game_ended','game_started','pending_sub','half_time','formation_change','player_of_match') THEN
      category := 'game';
    WHEN NEW.type IN ('points_awarded','reward_redeemed','early_rsvp_points','game_stats_ready','reward_available','leaderboard_update','streak_progress') THEN
      category := 'rewards';
    ELSE
      category := 'system';
  END CASE;

  SELECT * INTO prefs FROM public.notification_preferences WHERE user_id = NEW.user_id;
  IF prefs.user_id IS NOT NULL THEN
    CASE category
      WHEN 'messages' THEN should_send := COALESCE(prefs.messages_enabled, true);
      WHEN 'events' THEN should_send := COALESCE(prefs.events_enabled, true);
      WHEN 'media' THEN should_send := COALESCE(prefs.media_enabled, true);
      WHEN 'membership' THEN should_send := COALESCE(prefs.membership_enabled, true);
      ELSE should_send := true;
    END CASE;
  END IF;
  IF NOT should_send THEN
    RETURN NEW;
  END IF;

  msg_id := NULLIF(NEW.related_id::text, '');

  CASE NEW.type
    WHEN 'direct_message' THEN
      BEGIN
        IF msg_id IS NOT NULL THEN
          SELECT dm.id, dm.conversation_id INTO direct_msg_id_val, conv_id_val
          FROM public.direct_messages dm
          WHERE dm.id = msg_id::uuid;
        END IF;
        IF direct_msg_id_val IS NOT NULL AND conv_id_val IS NOT NULL THEN
          notification_url := '/messages/dm/' || conv_id_val::text || '?message=' || direct_msg_id_val::text;
        ELSIF msg_id IS NOT NULL THEN
          conv_id_val := msg_id::uuid;
          notification_url := '/messages/dm/' || msg_id;
        ELSE
          notification_url := '/messages';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        notification_url := '/messages';
      END;

    WHEN 'team_message','message_reply','message_reaction','message_mention' THEN
      BEGIN
        IF msg_id IS NOT NULL THEN
          SELECT tm.team_id INTO team_id_val FROM public.team_messages tm WHERE tm.id = msg_id::uuid;
        END IF;
        IF team_id_val IS NOT NULL THEN
          notification_url := '/messages/' || team_id_val::text || '?message=' || msg_id;
        ELSE
          notification_url := '/messages';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        notification_url := '/messages';
      END;

    WHEN 'club_message' THEN
      BEGIN
        IF msg_id IS NOT NULL THEN
          SELECT cm.club_id INTO club_id_val FROM public.club_messages cm WHERE cm.id = msg_id::uuid;
        END IF;
        IF club_id_val IS NOT NULL THEN
          notification_url := '/messages/club/' || club_id_val::text || '?message=' || msg_id;
        ELSE
          notification_url := '/messages';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        notification_url := '/messages';
      END;

    WHEN 'group_message','message_forwarded' THEN
      BEGIN
        IF msg_id IS NOT NULL THEN
          SELECT gm.group_id INTO group_id_val FROM public.group_messages gm WHERE gm.id = msg_id::uuid;
        END IF;
        IF group_id_val IS NOT NULL THEN
          notification_url := '/groups/' || group_id_val::text || '?message=' || msg_id;
        ELSE
          notification_url := '/messages';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        notification_url := '/messages';
      END;

    WHEN 'broadcast' THEN
      notification_url := '/messages/broadcast';

    WHEN 'event_invite','event_cancelled','event_reminder','event_view_reminder','event_updated','rsvp_reminder','rsvp_updated','duty_assigned','rsvp' THEN
      notification_url := CASE WHEN msg_id IS NOT NULL THEN '/events/' || msg_id ELSE '/events' END;

    WHEN 'photo_uploaded','photo_reaction' THEN
      notification_url := CASE WHEN msg_id IS NOT NULL THEN '/media?photo=' || msg_id ELSE '/media' END;

    WHEN 'photo_comment','comment_reaction','comment_reply' THEN
      notification_url := CASE WHEN msg_id IS NOT NULL THEN '/media?photo=' || msg_id || '&comments=1' ELSE '/media' END;

    WHEN 'pitch_board','pitch_board_update','substitution','substitution_alert','game_started','game_ended','game_finished','pending_sub','half_time','formation_change' THEN
      BEGIN
        IF msg_id IS NOT NULL THEN
          SELECT ag.team_id INTO game_team_id FROM public.active_games ag WHERE ag.id = msg_id::uuid;
        END IF;
        IF game_team_id IS NOT NULL THEN
          notification_url := '/teams/' || game_team_id::text || '?openPitchBoard=1';
        ELSIF msg_id IS NOT NULL THEN
          notification_url := '/events/' || msg_id;
        ELSE
          notification_url := '/';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        notification_url := '/';
      END;

    WHEN 'player_of_match','game_stats_ready' THEN
      notification_url := CASE WHEN msg_id IS NOT NULL THEN '/events/' || msg_id ELSE '/notifications' END;

    WHEN 'points_awarded','early_rsvp_points','reward_redeemed','leaderboard_update','streak_progress' THEN
      notification_url := '/profile?section=points-history';

    WHEN 'reward_available' THEN
      BEGIN
        IF msg_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.clubs WHERE id = msg_id::uuid) THEN
          notification_url := '/clubs/' || msg_id || '/rewards';
        ELSIF NEW.club_id IS NOT NULL THEN
          notification_url := '/clubs/' || NEW.club_id::text || '/rewards';
        ELSE
          notification_url := '/profile?section=rewards';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        notification_url := '/profile?section=rewards';
      END;

    WHEN 'team_invite' THEN
      BEGIN
        IF msg_id IS NOT NULL THEN
          SELECT ti.team_id INTO team_id_val FROM public.team_invites ti WHERE ti.id = msg_id::uuid;
          IF team_id_val IS NULL THEN
            SELECT pi.team_id INTO team_id_val FROM public.pending_invites pi WHERE pi.id = msg_id::uuid;
          END IF;
        END IF;
        IF team_id_val IS NOT NULL THEN
          notification_url := '/teams/' || team_id_val::text;
        ELSE
          notification_url := '/notifications';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        notification_url := '/notifications';
      END;

    WHEN 'role_assigned','invite_accepted','team_join' THEN
      notification_url := CASE WHEN msg_id IS NOT NULL THEN '/teams/' || msg_id ELSE '/notifications' END;

    WHEN 'member_joined' THEN
      BEGIN
        IF msg_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.mini_leagues WHERE id = msg_id::uuid) THEN
          notification_url := '/mini-leagues/' || msg_id;
        ELSIF msg_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.clubs WHERE id = msg_id::uuid) THEN
          notification_url := '/clubs/' || msg_id;
        ELSIF msg_id IS NOT NULL THEN
          notification_url := '/teams/' || msg_id;
        ELSE
          notification_url := '/notifications';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        notification_url := '/notifications';
      END;

    WHEN 'club_join' THEN
      notification_url := CASE WHEN msg_id IS NOT NULL THEN '/clubs/' || msg_id ELSE '/notifications' END;

    WHEN 'join_request_approved','join_request_denied','join_request_processed' THEN
      BEGIN
        IF msg_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.clubs WHERE id = msg_id::uuid) THEN
          notification_url := '/clubs/' || msg_id;
        ELSIF msg_id IS NOT NULL THEN
          notification_url := '/teams/' || msg_id;
        ELSE
          notification_url := '/notifications';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        notification_url := '/notifications';
      END;

    WHEN 'membership','role_removed','join_request' THEN
      notification_url := '/notifications';

    WHEN 'subscription_expiring','subscription_expired','subscription_renewed','storage_limit' THEN
      notification_url := '/account';

    ELSE
      notification_url := '/notifications';
  END CASE;

  notification_title := COALESCE(NEW.message, 'Notification');

  notification_tag := CASE
    WHEN NEW.type IN ('team_message','club_message','group_message','direct_message','message_reply','message_mention','message_reaction','message_forwarded') THEN
      NEW.type || '-' || NEW.id::text
    WHEN NEW.type = 'formation_change' THEN NEW.type || '-' || NEW.id::text
    ELSE NEW.type || '-' || COALESCE(NEW.related_id::text, NEW.id::text)
  END;

  SELECT net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1RupohNEQmQ_3MeHFFn8zDXhLM4as'
    ),
    body := jsonb_build_object(
      'userId', NEW.user_id::text,
      'title', notification_title,
      'body', '',
      'url', notification_url,
      'tag', notification_tag,
      'notificationType', NEW.type,
      'notificationId', NEW.id::text,
      'category', category,
      'data', jsonb_build_object(
        'notificationType', NEW.type,
        'type', NEW.type,
        'category', category,
        'message_id', CASE
          WHEN NEW.type = 'direct_message' AND direct_msg_id_val IS NOT NULL THEN direct_msg_id_val::text
          WHEN NEW.type IN ('team_message','club_message','group_message','message_reply','message_mention','message_reaction','message_forwarded') THEN msg_id
          ELSE NULL
        END,
        'related_id', msg_id,
        'team_id', COALESCE(team_id_val, game_team_id)::text,
        'club_id', club_id_val::text,
        'group_id', group_id_val::text,
        'conversation_id', conv_id_val::text
      )
    )
  ) INTO request_id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;