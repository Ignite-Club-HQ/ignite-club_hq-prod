-- Create function to send photo notification email
CREATE OR REPLACE FUNCTION public.send_photo_notification_email(
  p_recipient_user_id uuid, 
  p_uploader_user_id uuid, 
  p_photo_id uuid,
  p_context_type text,
  p_context_id uuid,
  p_context_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  supabase_url text;
  anon_key text;
BEGIN
  supabase_url := 'https://yabcfiuntwqjwvschnji.supabase.co';
  anon_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as';
  
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/send-photo-notification-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key
    ),
    body := jsonb_build_object(
      'recipientUserId', p_recipient_user_id,
      'uploaderUserId', p_uploader_user_id,
      'photoId', p_photo_id,
      'contextType', p_context_type,
      'contextId', p_context_id,
      'contextName', COALESCE(p_context_name, '')
    )
  );
END;
$function$;

-- Update the on_photo_uploaded trigger to include email notifications
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
  SELECT display_name INTO uploader_name FROM public.profiles WHERE id = NEW.uploader_id;
  
  IF NEW.team_id IS NOT NULL THEN
    SELECT name INTO team_name FROM public.teams WHERE id = NEW.team_id;
    notification_message := COALESCE(uploader_name, 'Someone') || ' uploaded a new photo to ' || COALESCE(team_name, 'your team');
    
    -- Create notifications and send emails for team members
    FOR member_user_id IN 
      SELECT DISTINCT ur.user_id 
      FROM public.user_roles ur
      WHERE ur.team_id = NEW.team_id 
        AND ur.user_id != NEW.uploader_id
    LOOP
      -- Insert notification
      INSERT INTO public.notifications (user_id, type, message, related_id)
      VALUES (member_user_id, 'photo_uploaded', notification_message, NEW.id)
      ON CONFLICT DO NOTHING;
      
      -- Send email notification
      PERFORM public.send_photo_notification_email(
        member_user_id,
        NEW.uploader_id,
        NEW.id,
        'team',
        NEW.team_id,
        team_name
      );
    END LOOP;
    
  ELSIF NEW.club_id IS NOT NULL THEN
    SELECT name INTO club_name FROM public.clubs WHERE id = NEW.club_id;
    notification_message := COALESCE(uploader_name, 'Someone') || ' uploaded a new photo to ' || COALESCE(club_name, 'your club');
    
    -- Create notifications and send emails for club members
    FOR member_user_id IN 
      SELECT DISTINCT ur.user_id 
      FROM public.user_roles ur
      WHERE ur.club_id = NEW.club_id 
        AND ur.user_id != NEW.uploader_id
    LOOP
      -- Insert notification
      INSERT INTO public.notifications (user_id, type, message, related_id)
      VALUES (member_user_id, 'photo_uploaded', notification_message, NEW.id)
      ON CONFLICT DO NOTHING;
      
      -- Send email notification
      PERFORM public.send_photo_notification_email(
        member_user_id,
        NEW.uploader_id,
        NEW.id,
        'club',
        NEW.club_id,
        club_name
      );
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$function$;