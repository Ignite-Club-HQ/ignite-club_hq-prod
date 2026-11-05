ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS coach_note text,
  ADD COLUMN IF NOT EXISTS coach_note_author uuid,
  ADD COLUMN IF NOT EXISTS coach_note_updated_at timestamptz;