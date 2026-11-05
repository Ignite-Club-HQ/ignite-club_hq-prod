
-- Change email notification defaults: only events and membership enabled by default
ALTER TABLE public.notification_preferences ALTER COLUMN email_messages_enabled SET DEFAULT false;
ALTER TABLE public.notification_preferences ALTER COLUMN email_media_enabled SET DEFAULT false;
ALTER TABLE public.notification_preferences ALTER COLUMN email_pitch_board_enabled SET DEFAULT false;
ALTER TABLE public.notification_preferences ALTER COLUMN email_pom_enabled SET DEFAULT false;
ALTER TABLE public.notification_preferences ALTER COLUMN email_rewards_enabled SET DEFAULT false;
ALTER TABLE public.notification_preferences ALTER COLUMN email_admin_enabled SET DEFAULT false;

-- events and membership stay true (already default true)
-- ALTER TABLE public.notification_preferences ALTER COLUMN email_events_enabled SET DEFAULT true;  -- already true
-- ALTER TABLE public.notification_preferences ALTER COLUMN email_membership_enabled SET DEFAULT true;  -- already true

-- Create a trigger to auto-create notification_preferences when a user completes their profile
CREATE OR REPLACE FUNCTION public.create_default_notification_preferences()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only trigger when display_name is set for the first time (profile completion)
  IF (TG_OP = 'INSERT' AND NEW.display_name IS NOT NULL) OR 
     (TG_OP = 'UPDATE' AND OLD.display_name IS NULL AND NEW.display_name IS NOT NULL) THEN
    INSERT INTO public.notification_preferences (
      user_id,
      email_messages_enabled,
      email_events_enabled,
      email_media_enabled,
      email_membership_enabled,
      email_pitch_board_enabled,
      email_pom_enabled,
      email_rewards_enabled,
      email_admin_enabled
    ) VALUES (
      NEW.id,
      false,  -- messages off
      true,   -- events on
      false,  -- media off
      true,   -- membership on
      false,  -- pitch board off
      false,  -- pom off
      false,  -- rewards off
      false   -- admin off
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_create_notification_prefs ON public.profiles;
CREATE TRIGGER on_profile_create_notification_prefs
  AFTER INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.create_default_notification_preferences();
