-- Function + trigger to send push notifications to existing users when they receive a pending invite
-- This detects if the invited email belongs to an existing user and notifies them in-app

CREATE OR REPLACE FUNCTION public.on_pending_invite_created()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  existing_user_id uuid;
  team_name_val text;
  club_name_val text;
  entity_name text;
  invite_url text;
  supabase_url text;
  anon_key text;
BEGIN
  -- Only process pending invites (not pre-accepted ones)
  IF NEW.status != 'pending' THEN
    RETURN NEW;
  END IF;

  -- If invited_user_id is already set, use it directly
  IF NEW.invited_user_id IS NOT NULL THEN
    existing_user_id := NEW.invited_user_id;
  ELSIF NEW.invited_email IS NOT NULL THEN
    -- Look up if this email belongs to an existing auth user
    SELECT au.id INTO existing_user_id
    FROM auth.users au
    WHERE lower(au.email) = lower(NEW.invited_email)
    LIMIT 1;
  END IF;

  -- No existing user found - email invite will handle new users
  IF existing_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Don't notify the person who sent the invite
  IF existing_user_id = NEW.invited_by_user_id THEN
    RETURN NEW;
  END IF;

  -- Get team name if this is a team invite
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

  -- Build the invite URL
  IF NEW.invite_token IS NOT NULL THEN
    IF NEW.team_id IS NOT NULL THEN
      invite_url := 'https://igniteclubhq.app/join/' || NEW.invite_token;
    ELSE
      invite_url := 'https://igniteclubhq.app/join-club/' || NEW.invite_token;
    END IF;
  END IF;

  -- Insert in-app notification - this will also trigger web push via existing notification trigger
  INSERT INTO public.notifications (user_id, type, message, related_id)
  VALUES (
    existing_user_id,
    'team_invite',
    'You''ve been invited to join ' || entity_name,
    NEW.id
  )
  ON CONFLICT DO NOTHING;

  -- Also directly call the push notification edge function with the correct deep-link URL
  -- so the push taps navigate directly to the invite page
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
        'body', 'Tap to join ' || entity_name || ' on Ignite Club HQ',
        'url', invite_url,
        'tag', 'invite-' || NEW.id::text,
        'notificationType', 'team_invite'
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Create the trigger
DROP TRIGGER IF EXISTS on_pending_invite_created ON public.pending_invites;
CREATE TRIGGER on_pending_invite_created
  AFTER INSERT ON public.pending_invites
  FOR EACH ROW
  EXECUTE FUNCTION public.on_pending_invite_created();
