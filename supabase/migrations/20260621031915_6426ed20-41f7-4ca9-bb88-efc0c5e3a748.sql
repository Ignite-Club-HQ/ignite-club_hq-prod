ALTER TABLE public.game_results DROP CONSTRAINT IF EXISTS game_results_sport_check;
ALTER TABLE public.game_results ADD CONSTRAINT game_results_sport_check
  CHECK (sport IS NOT NULL AND length(sport) > 0);