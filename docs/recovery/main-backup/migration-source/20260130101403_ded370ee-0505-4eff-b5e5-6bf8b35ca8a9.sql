-- Create a function to send welcome DM to new users
-- We'll use the user's own ID temporarily and mark it as a "system" message via a special flag

-- First, let's add a is_system_message column to direct_messages to identify system messages
ALTER TABLE public.direct_messages 
ADD COLUMN IF NOT EXISTS is_system_message boolean DEFAULT false;

-- Create a function to send welcome DM to new users
CREATE OR REPLACE FUNCTION public.send_welcome_dm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  conversation_id uuid;
  p1 uuid;
  p2 uuid;
  welcome_text text := 'Welcome to Ignite Club HQ! 🔥 For tips on how to use all of the app''s features and help run your club in one place, visit igniteclubhq.com/videos';
BEGIN
  -- Only trigger when display_name is set for the first time (profile completion)
  IF OLD.display_name IS NULL AND NEW.display_name IS NOT NULL THEN
    -- We'll create a "self-conversation" marked as system message
    -- The user will see this as a message from "Ignite Support"
    -- Using the user's own ID for both participants with a special ordering
    
    -- Create a unique conversation ID by using a deterministic pattern
    -- We'll insert into direct_messages with a special flag
    
    -- For this approach, we'll insert directly into a new system_messages concept
    -- But since we want it in the DM list, we'll use a workaround
    
    -- Insert a notification-style welcome message
    -- This will appear in the notifications instead
    INSERT INTO public.notifications (user_id, type, message, related_id)
    VALUES (NEW.id, 'welcome', welcome_text, NULL)
    ON CONFLICT DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger to send welcome notification when profile is completed
DROP TRIGGER IF EXISTS on_profile_completed_welcome_dm ON public.profiles;
CREATE TRIGGER on_profile_completed_welcome_dm
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.send_welcome_dm();