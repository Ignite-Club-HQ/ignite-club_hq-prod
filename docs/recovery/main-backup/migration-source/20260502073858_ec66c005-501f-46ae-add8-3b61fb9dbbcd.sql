-- Drop the partial unique index (ON CONFLICT requires a non-partial unique constraint/index)
DROP INDEX IF EXISTS public.game_results_event_id_unique;

-- Remove any duplicate rows per event_id, keeping the most recently updated
DELETE FROM public.game_results gr
USING public.game_results gr2
WHERE gr.event_id = gr2.event_id
  AND gr.event_id IS NOT NULL
  AND gr.ctid < gr2.ctid;

-- Create a true unique constraint usable by ON CONFLICT (event_id)
ALTER TABLE public.game_results
  ADD CONSTRAINT game_results_event_id_key UNIQUE (event_id);