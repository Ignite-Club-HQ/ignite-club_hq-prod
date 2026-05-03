-- Allow upsert on game_results by event_id
CREATE UNIQUE INDEX IF NOT EXISTS game_results_event_id_unique
  ON public.game_results (event_id)
  WHERE event_id IS NOT NULL;