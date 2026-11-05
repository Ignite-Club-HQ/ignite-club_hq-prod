-- Add active club theme preference column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN active_club_theme_id UUID REFERENCES public.clubs(id) ON DELETE SET NULL;