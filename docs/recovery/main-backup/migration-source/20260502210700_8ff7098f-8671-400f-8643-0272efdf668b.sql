-- Update push notification titles from "Ignite Club HQ" to "Ignite"
-- so device banners match app name across all notification types
-- (messages already used "Ignite" via the edge function default).

CREATE OR REPLACE FUNCTION public.send_push_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  notification_url text;
  prefs RECORD;
  category text;
  should_send boolean := true;
  request_id bigint;
  notification_tag text;
  resolved_photo_id uuid;
BEGIN
  IF NEW.skip_push = true THEN
    RETURN NEW;
  END IF;

  SELECT * INTO prefs FROM public.notification_preferences WHERE user_id = NEW.user_id;
  
  CASE 
    WHEN NEW.type IN ('team_message', 'club_message', 'group_message', 'broadcast', 'message_reply', 'message_reaction', 'message_mention', 'direct_message') THEN
      category := 'messages';
    WHEN NEW.type IN ('event_invite', 'event_cancelled', 'event_reminder', 'event_view_reminder', 'event_updated', 'rsvp_reminder', 'rsvp_updated', 'duty_assigned') THEN
      category := 'events';
    WHEN NEW.type IN ('photo_uploaded', 'photo_reaction', 'photo_comment', 'comment_reaction', 'comment_reply') THEN
      category := 'media';
    WHEN NEW.type IN ('membership', 'join_request', 'join_request_approved', 'join_request_denied', 'join_request_processed', 'role_assigned', 'role_removed', 'team_invite', 'team_join', 'club_join', 'member_joined', 'invite_accepted') THEN
      category := 'membership';
    WHEN NEW.type IN ('pitch_board', 'pitch_board_update', 'substitution', 'substitution_alert', 'game_finished', 'game_ended', 'game_started', 'pending_sub', 'half_time', 'formation_change') THEN
      category := 'pitch_board';
    WHEN NEW.type IN ('subscription_expiring', 'subscription_expired', 'subscription_renewed', 'storage_limit', 'system_announcement', 'admin_alert', 'system_update') THEN
      category := 'admin';
    WHEN NEW.type IN ('points_awarded', 'reward_redeemed', 'reward_available', 'early_rsvp_points') THEN
      category := 'rewards';
    WHEN NEW.type IN ('player_of_match', 'game_stats_ready') THEN
      category := 'pom';
    ELSE
      category := 'other';
  END CASE;
  
  IF prefs.id IS NOT NULL THEN
    CASE category
      WHEN 'messages' THEN should_send := prefs.messages_enabled;
      WHEN 'events' THEN should_send := prefs.events_enabled;
      WHEN 'media' THEN should_send := prefs.media_enabled;
      WHEN 'membership' THEN should_send := prefs.membership_enabled;
      WHEN 'pitch_board' THEN should_send := prefs.pitch_board_enabled;
      WHEN 'admin' THEN should_send := true;
      WHEN 'rewards' THEN should_send := prefs.rewards_enabled;
      WHEN 'pom' THEN should_send := prefs.pom_enabled;
      ELSE should_send := true;
    END CASE;
  END IF;
  
  IF NOT should_send THEN
    RETURN NEW;
  END IF;

  CASE NEW.type
    WHEN 'direct_message' THEN 
      notification_url := '/messages/dm/' || COALESCE(NEW.related_id::text, '');
    WHEN 'team_message', 'message_reply', 'message_reaction', 'message_mention' THEN 
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/messages/' || NEW.related_id ELSE '/messages' END;
    WHEN 'club_message' THEN 
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/messages/club/' || NEW.related_id ELSE '/messages' END;
    WHEN 'group_message' THEN 
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/groups/' || NEW.related_id ELSE '/messages' END;
    WHEN 'broadcast' THEN notification_url := '/messages/broadcast';
    WHEN 'event_invite', 'event_cancelled', 'event_reminder', 'event_view_reminder', 'event_updated', 'rsvp_reminder', 'rsvp_updated' THEN 
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/events/' || NEW.related_id ELSE '/events' END;
    WHEN 'duty_assigned' THEN
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/events/' || NEW.related_id ELSE '/events' END;
    WHEN 'photo_uploaded', 'photo_reaction' THEN
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/media?photo=' || NEW.related_id ELSE '/media' END;
    WHEN 'photo_comment', 'comment_reply' THEN
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/media?photo=' || NEW.related_id || '&comments=1' ELSE '/media' END;
    WHEN 'comment_reaction' THEN
      BEGIN
        SELECT pc.photo_id INTO resolved_photo_id
        FROM public.photo_comments pc
        WHERE pc.id = NEW.related_id::uuid;
        IF resolved_photo_id IS NOT NULL THEN
          notification_url := '/media?photo=' || resolved_photo_id || '&comments=1';
        ELSE
          notification_url := '/media';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        notification_url := '/media';
      END;
    WHEN 'points_awarded', 'reward_redeemed', 'early_rsvp_points', 'player_of_match', 'game_stats_ready' THEN notification_url := '/profile?section=points-history';
    WHEN 'formation_change', 'pending_sub', 'half_time', 'game_finished', 'pitch_board', 'substitution' THEN notification_url := '/';
    WHEN 'team_invite' THEN
      BEGIN
        SELECT pi.team_id INTO notification_url FROM public.pending_invites pi WHERE pi.id = NEW.related_id::uuid;
        IF notification_url IS NOT NULL THEN
          notification_url := '/teams/' || notification_url;
        ELSE
          notification_url := '/notifications';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        notification_url := '/notifications';
      END;
    WHEN 'member_joined' THEN
      BEGIN
        IF NEW.related_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.mini_leagues WHERE id = NEW.related_id::uuid) THEN
          notification_url := '/mini-leagues/' || NEW.related_id;
        ELSIF NEW.related_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.clubs WHERE id = NEW.related_id::uuid) THEN
          notification_url := '/clubs/' || NEW.related_id;
        ELSIF NEW.related_id IS NOT NULL THEN
          notification_url := '/teams/' || NEW.related_id;
        ELSE
          notification_url := '/notifications';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        notification_url := '/notifications';
      END;
    WHEN 'invite_accepted', 'team_join', 'role_assigned' THEN
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/teams/' || NEW.related_id ELSE '/notifications' END;
    WHEN 'club_join' THEN
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/clubs/' || NEW.related_id ELSE '/notifications' END;
    WHEN 'join_request' THEN notification_url := '/notifications';
    WHEN 'join_request_approved', 'join_request_denied', 'join_request_processed' THEN
      BEGIN
        IF NEW.related_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.clubs WHERE id = NEW.related_id::uuid) THEN
          notification_url := '/clubs/' || NEW.related_id;
        ELSIF NEW.related_id IS NOT NULL THEN
          notification_url := '/teams/' || NEW.related_id;
        ELSE
          notification_url := '/notifications';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        notification_url := '/notifications';
      END;
    WHEN 'role_removed', 'membership' THEN notification_url := '/notifications';
    WHEN 'subscription_expiring', 'subscription_expired', 'subscription_renewed', 'storage_limit' THEN notification_url := '/notifications';
    WHEN 'reward_available' THEN notification_url := '/notifications';
    ELSE notification_url := '/notifications';
  END CASE;

  notification_tag := CASE
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
      'title', 'Ignite',
      'body', NEW.message,
      'url', notification_url,
      'notificationId', NEW.id::text,
      'tag', notification_tag,
      'notificationType', NEW.type
    )
  ) INTO request_id;

  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.on_pending_invite_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  existing_user_id uuid;
  team_name_val text;
  club_name_val text;
  entity_name text;
  invite_url text;
  supabase_url text;
  anon_key text;
BEGIN
  IF NEW.status != 'pending' THEN
    RETURN NEW;
  END IF;

  IF NEW.invited_user_id IS NOT NULL THEN
    existing_user_id := NEW.invited_user_id;
  ELSIF NEW.invited_email IS NOT NULL THEN
    SELECT au.id INTO existing_user_id
    FROM auth.users au
    WHERE lower(au.email) = lower(NEW.invited_email)
    LIMIT 1;
  END IF;

  IF existing_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.invited_user_id IS NULL AND existing_user_id IS NOT NULL THEN
    NEW.invited_user_id := existing_user_id;
  END IF;

  IF existing_user_id = NEW.invited_by_user_id THEN
    RETURN NEW;
  END IF;

  IF NEW.team_id IS NOT NULL THEN
    SELECT t.name, c.name INTO team_name_val, club_name_val
    FROM public.teams t
    LEFT JOIN public.clubs c ON c.id = t.club_id
    WHERE t.id = NEW.team_id;
    entity_name := COALESCE(team_name_val, 'a team');
  ELSIF NEW.club_id IS NOT NULL THEN
    SELECT name INTO club_name_val FROM public.clubs WHERE id = NEW.club_id;
    entity_name := COALESCE(club_name_val, 'a club');
  ELSE
    entity_name := 'a team';
  END IF;

  IF NEW.invite_token IS NOT NULL THEN
    IF NEW.team_id IS NOT NULL THEN
      invite_url := 'https://igniteclubhq.app/join/' || NEW.invite_token;
    ELSE
      invite_url := 'https://igniteclubhq.app/join-club/' || NEW.invite_token;
    END IF;
  END IF;

  INSERT INTO public.notifications (user_id, type, message, related_id)
  VALUES (
    existing_user_id,
    'team_invite',
    'You''ve been invited to join ' || entity_name,
    NEW.id
  )
  ON CONFLICT DO NOTHING;

  IF invite_url IS NOT NULL THEN
    supabase_url := 'https://yabcfiuntwqjwvschnji.supabase.co';
    anon_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as';

    PERFORM net.http_post(
      url := supabase_url || '/functions/v1/send-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key
      ),
      body := jsonb_build_object(
        'userId', existing_user_id::text,
        'title', 'You''ve been invited! 👋',
        'body', 'Tap to join ' || entity_name || ' on Ignite',
        'url', invite_url,
        'tag', 'invite-' || NEW.id::text,
        'notificationType', 'team_invite'
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;