-- 1. Enforce one active broadcast per team (when team_id is set).
-- Uses a partial unique index so deactivated rows can accumulate freely
-- and team-less broadcasts (rare, legacy) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_games_team_active
  ON public.active_games (team_id)
  WHERE is_active = true AND team_id IS NOT NULL;

-- 2. Composite index for the most common spectator/sync read path:
--    "find the active row for THIS user and THIS team".
--    Replaces a sequential filter on top of the single-column is_active index.
CREATE INDEX IF NOT EXISTS idx_active_games_user_team_active
  ON public.active_games (user_id, team_id)
  WHERE is_active = true;

-- 3. Composite index for spectator read path:
--    "find the active row for THIS team" (any coach).
CREATE INDEX IF NOT EXISTS idx_active_games_team_active
  ON public.active_games (team_id, updated_at DESC)
  WHERE is_active = true;

-- 4. Drop the now-redundant single-column team_id index. The two new
--    partial composites above cover every team_id read pattern in the
--    sync hooks and spectator hook, and keeping the old index just
--    adds write overhead on every 10s sync.
DROP INDEX IF EXISTS public.idx_active_games_team_id;