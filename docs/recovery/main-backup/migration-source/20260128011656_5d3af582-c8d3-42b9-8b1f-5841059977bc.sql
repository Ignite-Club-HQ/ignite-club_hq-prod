-- Add min_players_per_side column to mini_leagues table
ALTER TABLE public.mini_leagues 
ADD COLUMN min_players_per_side integer NOT NULL DEFAULT 3;

-- Add a check constraint to ensure min is at least 2 and not more than team_size
ALTER TABLE public.mini_leagues
ADD CONSTRAINT min_players_valid CHECK (min_players_per_side >= 2 AND min_players_per_side <= team_size);

-- Update the Maxiroos league to have min_players_per_side = 3
UPDATE public.mini_leagues 
SET min_players_per_side = 3 
WHERE id = '17e2de8b-48c1-4dab-b399-031b30b7db52';