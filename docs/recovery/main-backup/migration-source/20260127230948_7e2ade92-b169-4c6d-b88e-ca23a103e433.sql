-- Add bib colors array to mini_leagues
ALTER TABLE public.mini_leagues
ADD COLUMN bib_colors text[] DEFAULT ARRAY['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#a855f7'];