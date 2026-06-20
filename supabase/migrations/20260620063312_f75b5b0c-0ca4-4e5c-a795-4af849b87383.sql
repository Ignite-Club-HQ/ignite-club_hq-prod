
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS association_id uuid REFERENCES public.clubs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS association_event_id uuid REFERENCES public.events(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_events_association_id
  ON public.events(association_id) WHERE association_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_association_event_id
  ON public.events(association_event_id) WHERE association_event_id IS NOT NULL;
