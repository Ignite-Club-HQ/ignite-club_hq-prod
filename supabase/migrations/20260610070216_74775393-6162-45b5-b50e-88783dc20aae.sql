
ALTER TABLE public.mini_league_players ALTER COLUMN ability_rating DROP NOT NULL;
ALTER TABLE public.mini_league_players DROP CONSTRAINT IF EXISTS mini_league_players_ability_rating_check;
ALTER TABLE public.mini_league_players ADD CONSTRAINT mini_league_players_ability_rating_check CHECK (ability_rating IS NULL OR (ability_rating >= 1 AND ability_rating <= 5));

ALTER TABLE public.child_mini_league_assignments ALTER COLUMN ability_rating DROP NOT NULL;
ALTER TABLE public.child_mini_league_assignments DROP CONSTRAINT IF EXISTS child_mini_league_assignments_ability_rating_check;
ALTER TABLE public.child_mini_league_assignments ADD CONSTRAINT child_mini_league_assignments_ability_rating_check CHECK (ability_rating IS NULL OR (ability_rating >= 1 AND ability_rating <= 5));
