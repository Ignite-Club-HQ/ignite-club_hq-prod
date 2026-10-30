-- Add events view mode preference to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS events_view_mode text DEFAULT 'list' CHECK (events_view_mode IN ('list', 'calendar'));