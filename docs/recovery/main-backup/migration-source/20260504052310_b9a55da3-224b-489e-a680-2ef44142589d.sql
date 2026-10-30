
-- Match goalkeepers: one row per goalkeeper per match (multiple allowed)
CREATE TABLE public.match_goalkeepers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  child_id uuid REFERENCES public.children(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_goalkeepers_one_target CHECK (
    (user_id IS NOT NULL AND child_id IS NULL)
    OR (user_id IS NULL AND child_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX match_goalkeepers_event_user_uniq
  ON public.match_goalkeepers(event_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX match_goalkeepers_event_child_uniq
  ON public.match_goalkeepers(event_id, child_id) WHERE child_id IS NOT NULL;
CREATE INDEX match_goalkeepers_event_idx ON public.match_goalkeepers(event_id);

ALTER TABLE public.match_goalkeepers ENABLE ROW LEVEL SECURITY;

-- Anyone who can view the event can see goalkeepers (mirror match_captains pattern)
CREATE POLICY "View match goalkeepers for accessible events"
ON public.match_goalkeepers
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = match_goalkeepers.event_id
  )
);

-- Only team admins / coaches / club admins can insert/delete
CREATE POLICY "Admins manage match goalkeepers - insert"
ON public.match_goalkeepers
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = match_goalkeepers.event_id
      AND (
        public.has_role(auth.uid(), 'app_admin'::app_role)
        OR (e.team_id IS NOT NULL AND (
          EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = auth.uid()
                    AND ur.team_id = e.team_id
                    AND ur.role IN ('team_admin','coach'))
        ))
        OR (e.club_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.club_id = e.club_id
            AND ur.role IN ('club_admin')
        ))
      )
  )
);

CREATE POLICY "Admins manage match goalkeepers - delete"
ON public.match_goalkeepers
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = match_goalkeepers.event_id
      AND (
        public.has_role(auth.uid(), 'app_admin'::app_role)
        OR (e.team_id IS NOT NULL AND (
          EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = auth.uid()
                    AND ur.team_id = e.team_id
                    AND ur.role IN ('team_admin','coach'))
        ))
        OR (e.club_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.club_id = e.club_id
            AND ur.role IN ('club_admin')
        ))
      )
  )
);

CREATE TRIGGER update_match_goalkeepers_updated_at
BEFORE UPDATE ON public.match_goalkeepers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
