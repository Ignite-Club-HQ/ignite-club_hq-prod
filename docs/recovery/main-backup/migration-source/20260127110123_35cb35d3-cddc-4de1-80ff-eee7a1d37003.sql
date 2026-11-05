-- Add mini_league_id to events table
ALTER TABLE public.events 
ADD COLUMN IF NOT EXISTS mini_league_id uuid REFERENCES public.mini_leagues(id) ON DELETE SET NULL;

-- Create event_groups table for breakout groups per event
CREATE TABLE IF NOT EXISTS public.event_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL,
  ability_band text,
  pitch_name text,
  pitch_state jsonb DEFAULT '{}'::jsonb,
  timer_state jsonb DEFAULT '{}'::jsonb,
  display_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create event_group_players for players in each group
CREATE TABLE IF NOT EXISTS public.event_group_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.event_groups(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.mini_league_players(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(group_id, player_id)
);

-- Create event_group_duties for duties per group
CREATE TABLE IF NOT EXISTS public.event_group_duties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.event_groups(id) ON DELETE CASCADE,
  name text NOT NULL,
  assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed')),
  points integer DEFAULT 0,
  points_awarded boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.event_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_group_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_group_duties ENABLE ROW LEVEL SECURITY;

-- RLS for event_groups
CREATE POLICY "Users can view event groups for events they can access" ON public.event_groups
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = event_id
    AND (
      public.is_club_member(auth.uid(), e.club_id)
      OR EXISTS (
        SELECT 1 FROM mini_league_players mlp
        WHERE mlp.mini_league_id = e.mini_league_id
        AND mlp.parent_user_id = auth.uid()
      )
    )
  )
);

CREATE POLICY "Admins can manage event groups" ON public.event_groups
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM events e
    JOIN user_roles ur ON ur.club_id = e.club_id
    WHERE e.id = event_id
    AND ur.user_id = auth.uid()
    AND ur.role IN ('club_admin', 'league_admin', 'app_admin')
  )
);

-- RLS for event_group_players
CREATE POLICY "Users can view event group players" ON public.event_group_players
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM event_groups eg
    JOIN events e ON e.id = eg.event_id
    WHERE eg.id = group_id
    AND (
      public.is_club_member(auth.uid(), e.club_id)
      OR EXISTS (
        SELECT 1 FROM mini_league_players mlp
        WHERE mlp.mini_league_id = e.mini_league_id
        AND mlp.parent_user_id = auth.uid()
      )
    )
  )
);

CREATE POLICY "Admins can manage event group players" ON public.event_group_players
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM event_groups eg
    JOIN events e ON e.id = eg.event_id
    JOIN user_roles ur ON ur.club_id = e.club_id
    WHERE eg.id = group_id
    AND ur.user_id = auth.uid()
    AND ur.role IN ('club_admin', 'league_admin', 'app_admin')
  )
);

-- RLS for event_group_duties
CREATE POLICY "Users can view event group duties" ON public.event_group_duties
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM event_groups eg
    JOIN events e ON e.id = eg.event_id
    WHERE eg.id = group_id
    AND (
      public.is_club_member(auth.uid(), e.club_id)
      OR EXISTS (
        SELECT 1 FROM mini_league_players mlp
        WHERE mlp.mini_league_id = e.mini_league_id
        AND mlp.parent_user_id = auth.uid()
      )
    )
  )
);

CREATE POLICY "Admins can manage event group duties" ON public.event_group_duties
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM event_groups eg
    JOIN events e ON e.id = eg.event_id
    JOIN user_roles ur ON ur.club_id = e.club_id
    WHERE eg.id = group_id
    AND ur.user_id = auth.uid()
    AND ur.role IN ('club_admin', 'league_admin', 'app_admin')
  )
);

-- Add triggers for updated_at
CREATE TRIGGER update_event_groups_updated_at
BEFORE UPDATE ON public.event_groups
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_event_group_duties_updated_at
BEFORE UPDATE ON public.event_group_duties
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_events_mini_league_id ON public.events(mini_league_id);
CREATE INDEX IF NOT EXISTS idx_event_groups_event_id ON public.event_groups(event_id);
CREATE INDEX IF NOT EXISTS idx_event_group_players_group_id ON public.event_group_players(group_id);
CREATE INDEX IF NOT EXISTS idx_event_group_duties_group_id ON public.event_group_duties(group_id);