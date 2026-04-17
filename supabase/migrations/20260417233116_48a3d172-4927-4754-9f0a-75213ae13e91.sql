-- Unified cross-sport game history (basketball + netball)
CREATE TABLE public.game_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  sport TEXT NOT NULL CHECK (sport IN ('basketball', 'netball')),
  home_label TEXT NOT NULL,
  away_label TEXT NOT NULL,
  home_score INTEGER NOT NULL DEFAULT 0,
  away_score INTEGER NOT NULL DEFAULT 0,
  period_scores JSONB NOT NULL DEFAULT '[]'::jsonb,
  player_stats JSONB NOT NULL DEFAULT '[]'::jsonb,
  mvp_player_id TEXT,
  mvp_player_name TEXT,
  played_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  saved_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent duplicate saves per event (when an event_id is provided)
CREATE UNIQUE INDEX game_results_event_unique
  ON public.game_results(event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX game_results_team_played_at_idx
  ON public.game_results(team_id, played_at DESC);

ALTER TABLE public.game_results ENABLE ROW LEVEL SECURITY;

-- Team members can view
CREATE POLICY "Team members can view game results"
  ON public.game_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.team_id = game_results.team_id
    )
  );

-- Team admins / coaches / club admins can insert
CREATE POLICY "Admins and coaches can save game results"
  ON public.game_results FOR INSERT
  WITH CHECK (
    saved_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.team_id = game_results.team_id
        AND user_roles.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role, 'club_admin'::app_role])
    )
  );

-- Admins/coaches OR the original saver can update
CREATE POLICY "Admins and savers can update game results"
  ON public.game_results FOR UPDATE
  USING (
    saved_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.team_id = game_results.team_id
        AND user_roles.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role, 'club_admin'::app_role])
    )
  );

-- Admins/coaches OR the original saver can delete
CREATE POLICY "Admins and savers can delete game results"
  ON public.game_results FOR DELETE
  USING (
    saved_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.team_id = game_results.team_id
        AND user_roles.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role, 'club_admin'::app_role])
    )
  );

-- Auto-update timestamp
CREATE TRIGGER update_game_results_updated_at
  BEFORE UPDATE ON public.game_results
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();