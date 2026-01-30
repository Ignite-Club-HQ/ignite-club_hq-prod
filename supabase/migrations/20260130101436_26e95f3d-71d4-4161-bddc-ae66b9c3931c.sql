-- Drop the trigger we just created since we'll handle this in code instead
DROP TRIGGER IF EXISTS on_profile_completed_welcome_dm ON public.profiles;
DROP FUNCTION IF EXISTS public.send_welcome_dm();