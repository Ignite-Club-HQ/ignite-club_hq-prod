CREATE TABLE IF NOT EXISTS public.event_session_drills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  drill_id uuid NOT NULL REFERENCES public.drills(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  added_by uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, drill_id)
);

CREATE INDEX IF NOT EXISTS idx_event_session_drills_event
  ON public.event_session_drills (event_id, position);

ALTER TABLE public.event_session_drills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View event drills if event visible"
ON public.event_session_drills
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_session_drills.event_id
  )
);

CREATE POLICY "Manage event drills as staff"
ON public.event_session_drills
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = event_session_drills.event_id
      AND (
        e.created_by = auth.uid()
        OR public.has_role(_user_id := auth.uid(), _role := 'app_admin'::public.app_role)
        OR (e.club_id IS NOT NULL AND public.is_club_admin(_user_id := auth.uid(), _club_id := e.club_id))
        OR (e.team_id IS NOT NULL AND public.has_role(_user_id := auth.uid(), _role := 'team_admin'::public.app_role, _team_id := e.team_id))
        OR (e.team_id IS NOT NULL AND public.has_role(_user_id := auth.uid(), _role := 'coach'::public.app_role, _team_id := e.team_id))
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = event_session_drills.event_id
      AND (
        e.created_by = auth.uid()
        OR public.has_role(_user_id := auth.uid(), _role := 'app_admin'::public.app_role)
        OR (e.club_id IS NOT NULL AND public.is_club_admin(_user_id := auth.uid(), _club_id := e.club_id))
        OR (e.team_id IS NOT NULL AND public.has_role(_user_id := auth.uid(), _role := 'team_admin'::public.app_role, _team_id := e.team_id))
        OR (e.team_id IS NOT NULL AND public.has_role(_user_id := auth.uid(), _role := 'coach'::public.app_role, _team_id := e.team_id))
      )
  )
);
