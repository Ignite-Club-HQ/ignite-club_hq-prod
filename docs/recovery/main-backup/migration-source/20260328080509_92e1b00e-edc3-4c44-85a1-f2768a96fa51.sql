-- 1. Update notify_admins_new_member to set related_id to mini_league_id for league_admin
CREATE OR REPLACE FUNCTION public.notify_admins_new_member()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  member_name text;
  context_name text;
  admin_record RECORD;
  role_label text;
  v_mini_league_id uuid;
BEGIN
  IF TG_OP != 'INSERT' THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO member_name FROM public.profiles WHERE id = NEW.user_id;
  member_name := COALESCE(member_name, 'A new member');

  CASE NEW.role::text
    WHEN 'player' THEN role_label := 'Player';
    WHEN 'parent' THEN role_label := 'Parent';
    WHEN 'coach' THEN role_label := 'Coach';
    WHEN 'team_admin' THEN role_label := 'Team Admin';
    WHEN 'club_admin' THEN role_label := 'Club Admin';
    WHEN 'league_admin' THEN role_label := 'League Admin';
    ELSE role_label := NEW.role::text;
  END CASE;

  IF NEW.team_id IS NOT NULL THEN
    SELECT name INTO context_name FROM public.teams WHERE id = NEW.team_id;
    context_name := COALESCE(context_name, 'the team');

    FOR admin_record IN
      SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
      WHERE ur.team_id = NEW.team_id
        AND ur.role IN ('team_admin', 'coach')
        AND ur.user_id != NEW.user_id
    LOOP
      INSERT INTO public.notifications (user_id, type, message, related_id)
      VALUES (admin_record.user_id, 'member_joined',
        member_name || ' has joined ' || context_name || ' as ' || role_label, NEW.team_id)
      ON CONFLICT DO NOTHING;
    END LOOP;

    FOR admin_record IN
      SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
      JOIN public.teams t ON t.club_id = ur.club_id
      WHERE t.id = NEW.team_id AND ur.role = 'club_admin' AND ur.user_id != NEW.user_id
    LOOP
      INSERT INTO public.notifications (user_id, type, message, related_id)
      VALUES (admin_record.user_id, 'member_joined',
        member_name || ' has joined ' || context_name || ' as ' || role_label, NEW.team_id)
      ON CONFLICT DO NOTHING;
    END LOOP;

  ELSIF NEW.club_id IS NOT NULL AND NEW.team_id IS NULL THEN
    IF NEW.role::text = 'league_admin' THEN
      SELECT ml.id, ml.name INTO v_mini_league_id, context_name
      FROM public.mini_leagues ml WHERE ml.club_id = NEW.club_id LIMIT 1;
      context_name := COALESCE(context_name, 'the league');

      FOR admin_record IN
        SELECT DISTINCT ur.user_id FROM public.user_roles ur
        WHERE ur.club_id = NEW.club_id AND ur.role = 'club_admin' AND ur.user_id != NEW.user_id
      LOOP
        INSERT INTO public.notifications (user_id, type, message, related_id)
        VALUES (admin_record.user_id, 'member_joined',
          member_name || ' has been added to ' || context_name || ' as ' || role_label,
          COALESCE(v_mini_league_id::text, NEW.club_id::text))
        ON CONFLICT DO NOTHING;
      END LOOP;
    ELSE
      SELECT name INTO context_name FROM public.clubs WHERE id = NEW.club_id;
      context_name := COALESCE(context_name, 'the club');

      FOR admin_record IN
        SELECT DISTINCT ur.user_id FROM public.user_roles ur
        WHERE ur.club_id = NEW.club_id AND ur.role = 'club_admin' AND ur.user_id != NEW.user_id
      LOOP
        INSERT INTO public.notifications (user_id, type, message, related_id)
        VALUES (admin_record.user_id, 'member_joined',
          member_name || ' has joined ' || context_name || ' as ' || role_label, NEW.club_id)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_admins_new_member failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;

-- 2. Update compute_push_notification_url to check mini_leagues for member_joined routing
CREATE OR REPLACE FUNCTION public.compute_push_notification_url()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  notification_url text;
  notification_tag text;
  supabase_url text;
  anon_key text;
  category text;
  team_id_val uuid;
BEGIN
  CASE
    WHEN NEW.type IN ('team_message', 'club_message', 'group_message', 'broadcast', 'message_reply', 'message_reaction', 'message_mention', 'direct_message') THEN
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

  CASE NEW.type
    WHEN 'direct_message' THEN 
      notification_url := '/messages/dm/' || COALESCE(NEW.related_id, '');
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
    WHEN 'photo_uploaded', 'photo_reaction', 'photo_comment', 'comment_reaction', 'comment_reply' THEN notification_url := '/media';
    WHEN 'points_awarded', 'reward_redeemed', 'early_rsvp_points', 'player_of_match', 'game_stats_ready' THEN notification_url := '/profile?section=points-history';
    WHEN 'formation_change', 'pending_sub', 'half_time', 'game_finished', 'pitch_board', 'substitution' THEN notification_url := '/';
    WHEN 'team_invite' THEN
      BEGIN
        SELECT pi.team_id INTO team_id_val FROM public.pending_invites pi WHERE pi.id = NEW.related_id::uuid;
        IF team_id_val IS NOT NULL THEN
          notification_url := '/teams/' || team_id_val::text;
        ELSE
          notification_url := '/notifications';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        notification_url := '/notifications';
      END;
    WHEN 'role_assigned', 'invite_accepted', 'team_join' THEN
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/teams/' || NEW.related_id ELSE '/notifications' END;
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
    WHEN 'club_join' THEN
      notification_url := CASE WHEN NEW.related_id IS NOT NULL THEN '/clubs/' || NEW.related_id ELSE '/notifications' END;
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
    WHEN 'membership', 'role_removed' THEN notification_url := '/notifications';
    WHEN 'join_request' THEN notification_url := '/notifications';
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
      'title', NEW.message,
      'body', '',
      'url', notification_url,
      'tag', notification_tag,
      'notificationType', NEW.type,
      'category', category
    )
  ) INTO notification_tag;

  RETURN NEW;
END;
$function$;