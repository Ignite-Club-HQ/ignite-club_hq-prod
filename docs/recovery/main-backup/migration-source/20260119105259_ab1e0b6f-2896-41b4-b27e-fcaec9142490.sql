-- Add theme preference column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN theme_preference TEXT DEFAULT 'dark' CHECK (theme_preference IN ('light', 'dark'));