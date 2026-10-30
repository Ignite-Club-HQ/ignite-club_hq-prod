-- Add linked_event_id to mini_league_sessions
ALTER TABLE public.mini_league_sessions 
ADD COLUMN linked_event_id uuid REFERENCES public.events(id) ON DELETE SET NULL;

-- Add index for faster lookups
CREATE INDEX idx_mini_league_sessions_event ON public.mini_league_sessions(linked_event_id);

-- Add mini_league to event types
ALTER TYPE public.event_type ADD VALUE IF NOT EXISTS 'mini_league';

-- Comment
COMMENT ON COLUMN public.mini_league_sessions.linked_event_id IS 'Reference to the auto-created event for this session';