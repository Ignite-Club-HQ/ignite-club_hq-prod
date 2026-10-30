
-- Club-wide default for allowing guests at social events
ALTER TABLE public.clubs 
  ADD COLUMN allow_guests_default BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN max_guests_per_member_default INTEGER NOT NULL DEFAULT 2;

-- Per-event override for allowing guests
ALTER TABLE public.events
  ADD COLUMN allow_guests BOOLEAN DEFAULT NULL,
  ADD COLUMN max_guests_per_member INTEGER DEFAULT NULL;

COMMENT ON COLUMN public.clubs.allow_guests_default IS 'Club-wide default: allow members to bring guests to social events';
COMMENT ON COLUMN public.clubs.max_guests_per_member_default IS 'Club-wide default: max guests each member can bring';
COMMENT ON COLUMN public.events.allow_guests IS 'Per-event override: allow guests. NULL = use club default';
COMMENT ON COLUMN public.events.max_guests_per_member IS 'Per-event override: max guests per member. NULL = use club default';

-- Table to store event guests (non-members)
CREATE TABLE public.event_guests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  added_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for efficient querying
CREATE INDEX idx_event_guests_event_id ON public.event_guests(event_id);
CREATE INDEX idx_event_guests_added_by ON public.event_guests(added_by);

-- Enable RLS
ALTER TABLE public.event_guests ENABLE ROW LEVEL SECURITY;

-- Members can view all guests for events they can see
CREATE POLICY "Authenticated users can view event guests"
  ON public.event_guests
  FOR SELECT
  TO authenticated
  USING (true);

-- Members can insert their own guests
CREATE POLICY "Users can add their own guests"
  ON public.event_guests
  FOR INSERT
  TO authenticated
  WITH CHECK (added_by = auth.uid());

-- Members can delete their own guests
CREATE POLICY "Users can remove their own guests"
  ON public.event_guests
  FOR DELETE
  TO authenticated
  USING (added_by = auth.uid());

-- Admins can also delete any guest (club_admin or team_admin for that event's club)
CREATE POLICY "Admins can remove any guest"
  ON public.event_guests
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      JOIN public.user_roles ur ON ur.club_id = e.club_id
      WHERE e.id = event_guests.event_id
        AND ur.user_id = auth.uid()
        AND ur.role IN ('club_admin', 'app_admin')
    )
  );
