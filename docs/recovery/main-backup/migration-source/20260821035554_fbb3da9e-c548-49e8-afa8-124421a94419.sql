CREATE TABLE public.event_lineups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  team_id uuid NOT NULL,
  lineup jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_lineups_event_team_unique UNIQUE (event_id, team_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_lineups TO authenticated;
GRANT ALL ON public.event_lineups TO service_role;

ALTER TABLE public.event_lineups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members and board controllers can view event lineups"
ON public.event_lineups FOR SELECT TO authenticated
USING (
  public.is_team_member(auth.uid(), team_id)
  OR public.can_control_pitch_board(team_id, event_id)
  OR public.has_role(auth.uid(), 'app_admin'::app_role, NULL, NULL)
);

CREATE POLICY "Board controllers can create event lineups"
ON public.event_lineups FOR INSERT TO authenticated
WITH CHECK (
  public.can_control_pitch_board(team_id, event_id)
  OR public.can_manage_team_roster(auth.uid(), team_id)
);

CREATE POLICY "Board controllers can update event lineups"
ON public.event_lineups FOR UPDATE TO authenticated
USING (
  public.can_control_pitch_board(team_id, event_id)
  OR public.can_manage_team_roster(auth.uid(), team_id)
)
WITH CHECK (
  public.can_control_pitch_board(team_id, event_id)
  OR public.can_manage_team_roster(auth.uid(), team_id)
);

CREATE POLICY "Board controllers can delete event lineups"
ON public.event_lineups FOR DELETE TO authenticated
USING (
  public.can_control_pitch_board(team_id, event_id)
  OR public.can_manage_team_roster(auth.uid(), team_id)
);

CREATE INDEX idx_event_lineups_team ON public.event_lineups(team_id, updated_at DESC);

CREATE TRIGGER event_lineups_set_updated_at
BEFORE UPDATE ON public.event_lineups
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();