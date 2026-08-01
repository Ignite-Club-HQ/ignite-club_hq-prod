WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY user_id ORDER BY updated_at DESC, id DESC) AS rn
  FROM public.active_games
  WHERE is_active = true AND team_id IS NULL
)
UPDATE public.active_games ag
SET is_active = false
FROM ranked
WHERE ag.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_games_user_active_personal
  ON public.active_games (user_id)
  WHERE is_active = true AND team_id IS NULL;