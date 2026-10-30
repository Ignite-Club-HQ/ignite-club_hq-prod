-- Rewrite the LIVE push-notification trigger to deep-link correctly for every
-- notification type. The previous compute_push_notification_url() function was
-- created but never attached as a trigger; we fold its logic into
-- send_push_notification() which IS attached to public.notifications.

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
  photo_team_id uuid;
  photo_club_id uuid;
  game_team_id uuid;
  notification_title text;
BEGIN
  -- Allow callers (e.g. check-pending-subs edge function) to opt out of the
  -- automatic push when they are dispatching one themselves with a richer URL.
  IF NEW.skip_push = true THEN
    RETURN NEW;
  END IF;

  -- Category classification (used for per-user pref gating and client routing).
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

  -- Per-user category toggle gating.
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

  -- Per-type URL resolution. Each branch is wrapped in a BEGIN/EXCEPTION so a
  -- single bad lookup never blocks the notification insert.
  CASE NEW.type

    WHEN 'direct_message' THEN
      -- related_id is the direct_conversations id.
      notification_url := CASE WHEN msg_id IS NOT NULL THEN '/messages/dm/' || msg_id ELSE '/messages' END;

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

    -- Photo notifications: related_id is the photo id. MediaPage consumes
    -- ?photo={id} (scrolls + opens lightbox); for comment-flavoured types we
    -- also append &comments=1 so the comment sheet auto-opens.
    WHEN 'photo_uploaded','photo_reaction' THEN
      notification_url := CASE WHEN msg_id IS NOT NULL THEN '/media?photo=' || msg_id ELSE '/media' END;

    WHEN 'photo_comment','comment_reaction','comment_reply' THEN
      notification_url := CASE WHEN msg_id IS NOT NULL THEN '/media?photo=' || msg_id || '&comments=1' ELSE '/media' END;

    -- Pitch board: related_id is the active_games.id. Resolve to team_id and
    -- deep-link to /teams/{teamId}?openPitchBoard=1, which the team page and
    -- PitchBoardResumeRedirect both consume to re-open the board.
    WHEN 'pitch_board','pitch_board_update','substitution','substitution_alert','game_started','game_ended','game_finished','pending_sub','half_time','formation_change' THEN
      BEGIN
        IF msg_id IS NOT NULL THEN
          SELECT ag.team_id INTO game_team_id FROM public.active_games ag WHERE ag.id = msg_id::uuid;
        END IF;
        IF game_team_id IS NOT NULL THEN
          notification_url := '/teams/' || game_team_id::text || '?openPitchBoard=1';
        ELSIF msg_id IS NOT NULL THEN
          -- Fallback: treat related_id as an event id (older notifications)
          notification_url := '/events/' || msg_id;
        ELSE
          notification_url := '/';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        notification_url := '/';
      END;

    WHEN 'player_of_match','game_stats_ready' THEN
      -- related_id may be an event or a game; events page handles both.
      notification_url := CASE WHEN msg_id IS NOT NULL THEN '/events/' || msg_id ELSE '/notifications' END;

    -- Rewards & points
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

    -- Membership / invites
    WHEN 'team_invite' THEN
      BEGIN
        -- related_id may be the team_invites OR pending_invites row id.
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

  -- Per-notification tag so Android FCM doesn't collapse concurrent unread
  -- pushes (chat messages especially).
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
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as'
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
        'message_id', CASE WHEN NEW.type IN ('team_message','club_message','group_message','direct_message','message_reply','message_mention','message_reaction','message_forwarded') THEN msg_id ELSE NULL END,
        'related_id', msg_id,
        'team_id', COALESCE(team_id_val, game_team_id)::text,
        'club_id', club_id_val::text,
        'group_id', group_id_val::text
      )
    )
  ) INTO request_id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the notification insert because push delivery failed.
  RETURN NEW;
END;
$function$;