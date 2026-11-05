-- Create event_views table to track when users view events
CREATE TABLE public.event_views (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(event_id, user_id)
);

-- Enable Row Level Security
ALTER TABLE public.event_views ENABLE ROW LEVEL SECURITY;

-- Users can view their own event views
CREATE POLICY "Users can view their own event views"
ON public.event_views
FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own event views
CREATE POLICY "Users can insert their own event views"
ON public.event_views
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Admins can view all event views for their club/team events
CREATE POLICY "Admins can view event views for their events"
ON public.event_views
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_id
    AND (
      -- App admin
      EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid() AND ur.role = 'app_admin'
      )
      -- Club admin
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid() 
        AND ur.club_id = e.club_id 
        AND ur.role = 'club_admin'
      )
      -- Team admin/coach for team events
      OR (e.team_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid() 
        AND ur.team_id = e.team_id 
        AND ur.role IN ('team_admin', 'coach')
      ))
      -- League admin for mini-league events
      OR (e.mini_league_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid() 
        AND ur.club_id = e.club_id 
        AND ur.role IN ('league_admin', 'club_admin')
      ))
    )
  )
);

-- Create index for efficient lookups
CREATE INDEX idx_event_views_event_id ON public.event_views(event_id);
CREATE INDEX idx_event_views_user_id ON public.event_views(user_id);
CREATE INDEX idx_event_views_event_user ON public.event_views(event_id, user_id);