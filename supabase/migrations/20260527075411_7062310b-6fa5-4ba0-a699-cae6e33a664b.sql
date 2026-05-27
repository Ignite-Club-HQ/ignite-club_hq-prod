
CREATE OR REPLACE FUNCTION public.compute_push_notification_url()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  notification_url text;
  notification_tag text;
  category text;
  team_id_val uuid;
  club_id_val uuid;
  group_id_val uuid;
  msg_id text;
  http_id bigint;
BEGIN
  CASE
    WHEN NEW.type IN ('team_message', 'club_message', 'group_message', 'broadcast', 'message_reply', 'message_reaction', 'message_mention', 'direct_message', 'message_forwarded') THEN
      category := 'chat';
    WHEN NEW.type IN ('event_invite', 'event_cancelled', 'event_reminder', 'event_view_reminder', 'event_updated', 'rsvp_reminder', 'rsvp_updated', 'duty_assigned', 'rsvp') THEN
      category := 'events';
    WHEN NEW.type IN ('photo_uploaded', 'photo_reaction', 'photo_comment', 'comment_reaction', 'comment_reply') THEN
      category := 'media';
    WHEN NEW.type IN ('membership', 'join_request', 'join_request_approved', 'join_request_denied', 'join_request_processed', 'role_assigned', 'role_removed', 'team_invite', 'team_join', 'club_join', 'member_joined', 'invite_accepted') THEN
      category := 'membership';
    WHEN NEW.type IN ('pitch_board', 'pitch_board_update', 'substitution', 'substitution_alert', 'game_finished', 'game_ended', 'game_started', 'pending_sub', 'half_time', 'formation_change') THEN
      category := 'game';
    WHEN NEW.type IN ('points_awarded', 'reward_redeemed', 'early_rsvp_points', 'player_of_match', 'game_stats_ready', 'reward_available') THEN
      category := 'rewards';
    WHEN NEW.type IN ('fee_payment_request', 'payment_received', 'payment_overdue') THEN
      category := 'payments';
    WHEN NEW.type IN ('subscription_expiring', 'subscription_expired', 'subscription_renewed', 'storage_limit', 'system_announcement') THEN
      category := 'admin';
    ELSE
      category := 'general';
  END CASE;

  NEW.category := category;

  msg_id := NULLIF(NEW.related_id::text, '');

  CASE NEW.type
    WHEN 'direct_message' THEN
      -- related_id is the conversation id
      notification_url := CASE WHEN msg_id IS NOT NULL THEN '/messages/dm/' || msg_id ELSE '/messages' END;

    WHEN 'team_message', 'message_reply', 'message_reaction', 'message_mention' THEN
      -- related_id is the team_message id; resolve to its team
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

    WHEN 'group_message', 'message_forwarded' THEN
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

    WHEN 'broadcast' THEN notification_url := '/messages/broadcast';

    WHEN 'event_invite', 'event_cancelled', 'event_reminder', 'event_view_reminder', 'event_updated', 'rsvp_reminder', 'rsvp_updated', 'duty_assigned' THEN
      notification_url := CASE WHEN msg_id IS NOT NULL THEN '/events/' || msg_id ELSE '/events' END;

    WHEN 'photo_uploaded', 'photo_reaction', 'photo_comment', 'comment_reaction', 'comment_reply' THEN
      notification_url := CASE WHEN msg_id IS NOT NULL THEN '/media?photo=' || msg_id ELSE '/media' END;

    WHEN 'points_awarded', 'reward_redeemed', 'early_rsvp_points', 'player_of_match', 'game_stats_ready' THEN
      notification_url := '/profile?section=points-history';

    WHEN 'formation_change', 'pending_sub', 'half_time', 'game_finished', 'pitch_board', 'substitution' THEN
      notification_url := '/';

    WHEN 'team_invite' THEN
      BEGIN
        IF msg_id IS NOT NULL THEN
          SELECT ti.team_id INTO team_id_val FROM public.team_invites ti WHERE ti.id = msg_id::uuid;
        END IF;
        IF team_id_val IS NOT NULL THEN
          notification_url := '/teams/' || team_id_val::text;
        ELSE
          notification_url := '/notifications';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        notification_url := '/notifications';
      END;

    WHEN 'role_assigned', 'invite_accepted', 'team_join' THEN
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

    WHEN 'join_request_approved', 'join_request_denied', 'join_request_processed' THEN
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

    WHEN 'membership', 'role_removed' THEN notification_url := '/notifications';
    WHEN 'join_request' THEN notification_url := '/notifications';
    WHEN 'subscription_expiring', 'subscription_expired', 'subscription_renewed', 'storage_limit' THEN notification_url := '/notifications';
    WHEN 'reward_available' THEN notification_url := '/notifications';
    ELSE notification_url := '/notifications';
  END CASE;

  -- Per-message tag so concurrent unread notifications don't collapse on Android
  notification_tag := CASE
    WHEN NEW.type IN ('team_message','club_message','group_message','direct_message','message_reply','message_mention','message_reaction','message_forwarded') THEN
      NEW.type || '-' || NEW.id::text
    WHEN NEW.type = 'formation_change' THEN NEW.type || '-' || NEW.id::text
    ELSE NEW.type || '-' || COALESCE(NEW.related_id, NEW.id)::text
  END;

  SELECT net.http_post(
    url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as'
    ),
    body := jsonb_build_object(
      'userId', NEW.user_id::text,
      'title', NEW.message,
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
        'message_id', CASE WHEN NEW.type IN ('team_message','club_message','group_message','direct_message','message_reply','message_mention','message_reaction','message_forwarded') THEN msg_id ELSE NULL END,
        'related_id', msg_id,
        'team_id', team_id_val::text,
        'club_id', club_id_val::text,
        'group_id', group_id_val::text
      )
    )
  ) INTO http_id;

  RETURN NEW;
END;
$function$;
