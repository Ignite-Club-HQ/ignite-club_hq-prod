-- Add board_session_id to active_games
ALTER TABLE public.active_games
  ADD COLUMN IF NOT EXISTS board_session_id uuid NOT NULL DEFAULT gen_random_uuid();

-- Backfill any existing rows that may have been created before the default kicked in
UPDATE public.active_games
SET board_session_id = gen_random_uuid()
WHERE board_session_id IS NULL;

-- Fast lookup by session token (spectator deep-links, board handover, etc.)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_games_board_session_id
  ON public.active_games (board_session_id);

-- Fast lookup of "the active board for this team" returning its session id
CREATE INDEX IF NOT EXISTS idx_active_games_team_session_active
  ON public.active_games (team_id, board_session_id)
  WHERE is_active = true;

-- Comment for future maintainers
COMMENT ON COLUMN public.active_games.board_session_id IS
  'Stable identifier for one continuous coaching board session. Spectators lock onto this so a brief deactivation/replacement of the active_games row does not redirect them to another team''s board. Generated once when a board first syncs and reused for the lifetime of that session.';