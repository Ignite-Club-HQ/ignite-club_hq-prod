
CREATE OR REPLACE FUNCTION public.on_user_blocked()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  blocker_name text;
  blocked_name text;
  blocker_email text;
  blocked_email text;
  supabase_url text;
  anon_key text;
BEGIN
  SELECT display_name INTO blocker_name FROM public.profiles WHERE id = NEW.blocker_id;
  SELECT display_name INTO blocked_name FROM public.profiles WHERE id = NEW.blocked_id;
  SELECT email INTO blocker_email FROM auth.users WHERE id = NEW.blocker_id;
  SELECT email INTO blocked_email FROM auth.users WHERE id = NEW.blocked_id;
  
  INSERT INTO public.admin_alerts (alert_type, details)
  VALUES ('user_blocked', jsonb_build_object(
    'blocker_id', NEW.blocker_id,
    'blocker_name', COALESCE(blocker_name, 'Unknown'),
    'blocked_id', NEW.blocked_id,
    'blocked_name', COALESCE(blocked_name, 'Unknown'),
    'reason', NEW.reason
  ));

  -- Send email notification to privacy team
  supabase_url := 'https://yabcfiuntwqjwvschnji.supabase.co';
  anon_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as';

  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/send-block-alert-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key
    ),
    body := jsonb_build_object(
      'blockerName', COALESCE(blocker_name, 'Unknown'),
      'blockerEmail', COALESCE(blocker_email, 'no email'),
      'blockedName', COALESCE(blocked_name, 'Unknown'),
      'blockedEmail', COALESCE(blocked_email, 'no email'),
      'reason', NEW.reason
    )
  );
  
  RETURN NEW;
END;
$function$;
