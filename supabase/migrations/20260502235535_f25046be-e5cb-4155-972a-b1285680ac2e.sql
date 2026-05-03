
CREATE TABLE public.match_captains (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id UUID,
  child_id UUID REFERENCES public.children(id) ON DELETE CASCADE,
  assigned_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT match_captains_event_unique UNIQUE (event_id),
  CONSTRAINT match_captains_subject_check CHECK (
    (user_id IS NOT NULL AND child_id IS NULL) OR
    (user_id IS NULL AND child_id IS NOT NULL)
  )
);

CREATE INDEX idx_match_captains_event ON public.match_captains(event_id);
CREATE INDEX idx_match_captains_user ON public.match_captains(user_id);
CREATE INDEX idx_match_captains_child ON public.match_captains(child_id);

ALTER TABLE public.match_captains ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_match_captains_updated_at
BEFORE UPDATE ON public.match_captains
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Users can view captain for accessible events"
ON public.match_captains
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = match_captains.event_id
      AND (
        public.is_club_member(auth.uid(), e.club_id)
        OR (e.team_id IS NOT NULL AND public.is_team_member(auth.uid(), e.team_id))
        OR public.has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
      )
  )
);

CREATE POLICY "Admins and coaches can manage captain"
ON public.match_captains
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = match_captains.event_id
      AND (
        public.has_role(auth.uid(), 'club_admin'::app_role, e.club_id, NULL::uuid)
        OR public.has_role(auth.uid(), 'team_admin'::app_role, NULL::uuid, e.team_id)
        OR public.has_role(auth.uid(), 'coach'::app_role, NULL::uuid, e.team_id)
        OR public.has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = match_captains.event_id
      AND (
        public.has_role(auth.uid(), 'club_admin'::app_role, e.club_id, NULL::uuid)
        OR public.has_role(auth.uid(), 'team_admin'::app_role, NULL::uuid, e.team_id)
        OR public.has_role(auth.uid(), 'coach'::app_role, NULL::uuid, e.team_id)
        OR public.has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
      )
  )
);
