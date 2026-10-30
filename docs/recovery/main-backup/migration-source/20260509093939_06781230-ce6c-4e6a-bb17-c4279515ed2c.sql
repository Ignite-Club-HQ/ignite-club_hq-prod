CREATE TABLE public.schedule_broadcasts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  team_id uuid NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  bumped_by uuid NOT NULL,
  bumped_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_schedule_broadcasts_club_bumped
  ON public.schedule_broadcasts (club_id, bumped_at DESC);
CREATE INDEX idx_schedule_broadcasts_team_bumped
  ON public.schedule_broadcasts (team_id, bumped_at DESC)
  WHERE team_id IS NOT NULL;

ALTER TABLE public.schedule_broadcasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read their club's schedule broadcasts"
ON public.schedule_broadcasts
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.club_id = schedule_broadcasts.club_id
  )
);

CREATE POLICY "Admins can broadcast schedule refresh"
ON public.schedule_broadcasts
FOR INSERT
TO authenticated
WITH CHECK (
  bumped_by = auth.uid()
  AND (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('app_admin','league_admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.club_id = schedule_broadcasts.club_id
        AND ur.role = 'club_admin'
    )
    OR (
      schedule_broadcasts.team_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.team_id = schedule_broadcasts.team_id
          AND ur.role IN ('team_admin','coach')
      )
    )
  )
);

ALTER PUBLICATION supabase_realtime ADD TABLE public.schedule_broadcasts;
ALTER TABLE public.schedule_broadcasts REPLICA IDENTITY FULL;