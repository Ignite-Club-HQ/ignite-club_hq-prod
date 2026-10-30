-- Mini Leagues table
CREATE TABLE public.mini_leagues (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  team_size INTEGER NOT NULL DEFAULT 5,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Mini League Players (the pool)
CREATE TABLE public.mini_league_players (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mini_league_id UUID NOT NULL REFERENCES public.mini_leagues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ability_rating INTEGER NOT NULL DEFAULT 3 CHECK (ability_rating >= 1 AND ability_rating <= 5),
  notes TEXT,
  parent_user_id UUID REFERENCES auth.users(id),
  child_id UUID REFERENCES public.children(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Mini League Sessions
CREATE TABLE public.mini_league_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mini_league_id UUID NOT NULL REFERENCES public.mini_leagues(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME,
  location_name TEXT,
  address TEXT,
  postcode TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'locked')),
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Player Availability per Session
CREATE TABLE public.mini_league_session_availability (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.mini_league_sessions(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.mini_league_players(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('available', 'unavailable', 'late', 'unknown')),
  marked_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(session_id, player_id)
);

-- Ability-based Groups per Session
CREATE TABLE public.mini_league_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.mini_league_sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ability_band TEXT,
  target_size INTEGER NOT NULL DEFAULT 5,
  pitch_name TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Players assigned to Groups for a Session
CREATE TABLE public.mini_league_group_players (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES public.mini_league_groups(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.mini_league_players(id) ON DELETE CASCADE,
  jersey_number INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(group_id, player_id)
);

-- Enable RLS on all tables
ALTER TABLE public.mini_leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mini_league_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mini_league_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mini_league_session_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mini_league_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mini_league_group_players ENABLE ROW LEVEL SECURITY;

-- Helper function: Check if user is a league admin
CREATE OR REPLACE FUNCTION is_league_admin(p_user_id UUID, p_mini_league_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN mini_leagues ml ON ml.club_id = ur.club_id
    WHERE ur.user_id = p_user_id
    AND ml.id = p_mini_league_id
    AND ur.role IN ('league_admin', 'club_admin', 'app_admin')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Helper function: Check if user is a parent of a player in the league
CREATE OR REPLACE FUNCTION is_league_parent(p_user_id UUID, p_mini_league_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM mini_league_players
    WHERE mini_league_id = p_mini_league_id
    AND parent_user_id = p_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- RLS Policies for mini_leagues
CREATE POLICY "Club members can view mini leagues"
  ON public.mini_leagues FOR SELECT
  USING (is_club_member(auth.uid(), club_id));

CREATE POLICY "League admins can create mini leagues"
  ON public.mini_leagues FOR INSERT
  WITH CHECK (
    has_role(auth.uid(), 'club_admin', club_id, NULL) OR
    has_role(auth.uid(), 'league_admin', club_id, NULL) OR
    has_role(auth.uid(), 'app_admin', NULL, NULL)
  );

CREATE POLICY "League admins can update mini leagues"
  ON public.mini_leagues FOR UPDATE
  USING (is_league_admin(auth.uid(), id));

CREATE POLICY "League admins can delete mini leagues"
  ON public.mini_leagues FOR DELETE
  USING (is_league_admin(auth.uid(), id));

-- RLS Policies for mini_league_players
CREATE POLICY "League members can view players"
  ON public.mini_league_players FOR SELECT
  USING (
    is_league_admin(auth.uid(), mini_league_id) OR
    is_league_parent(auth.uid(), mini_league_id)
  );

CREATE POLICY "League admins can insert players"
  ON public.mini_league_players FOR INSERT
  WITH CHECK (is_league_admin(auth.uid(), mini_league_id));

CREATE POLICY "League admins can update players"
  ON public.mini_league_players FOR UPDATE
  USING (is_league_admin(auth.uid(), mini_league_id));

CREATE POLICY "League admins can delete players"
  ON public.mini_league_players FOR DELETE
  USING (is_league_admin(auth.uid(), mini_league_id));

-- RLS Policies for mini_league_sessions
CREATE POLICY "League members can view sessions"
  ON public.mini_league_sessions FOR SELECT
  USING (
    is_league_admin(auth.uid(), mini_league_id) OR
    is_league_parent(auth.uid(), mini_league_id)
  );

CREATE POLICY "League admins can insert sessions"
  ON public.mini_league_sessions FOR INSERT
  WITH CHECK (is_league_admin(auth.uid(), mini_league_id));

CREATE POLICY "League admins can update sessions"
  ON public.mini_league_sessions FOR UPDATE
  USING (is_league_admin(auth.uid(), mini_league_id));

CREATE POLICY "League admins can delete sessions"
  ON public.mini_league_sessions FOR DELETE
  USING (is_league_admin(auth.uid(), mini_league_id));

-- RLS Policies for mini_league_session_availability
CREATE POLICY "League members can view availability"
  ON public.mini_league_session_availability FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM mini_league_sessions s
      WHERE s.id = session_id
      AND (is_league_admin(auth.uid(), s.mini_league_id) OR is_league_parent(auth.uid(), s.mini_league_id))
    )
  );

CREATE POLICY "League admins can insert availability"
  ON public.mini_league_session_availability FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM mini_league_sessions s
      WHERE s.id = session_id
      AND is_league_admin(auth.uid(), s.mini_league_id)
    )
    OR
    EXISTS (
      SELECT 1 FROM mini_league_sessions s
      JOIN mini_league_players p ON p.mini_league_id = s.mini_league_id
      WHERE s.id = session_id
      AND p.id = player_id
      AND p.parent_user_id = auth.uid()
    )
  );

CREATE POLICY "League admins can update availability"
  ON public.mini_league_session_availability FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM mini_league_sessions s
      WHERE s.id = session_id
      AND is_league_admin(auth.uid(), s.mini_league_id)
    )
  );

CREATE POLICY "Parents can update their child availability"
  ON public.mini_league_session_availability FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM mini_league_players p
      WHERE p.id = player_id
      AND p.parent_user_id = auth.uid()
    )
  );

CREATE POLICY "League admins can delete availability"
  ON public.mini_league_session_availability FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM mini_league_sessions s
      WHERE s.id = session_id
      AND is_league_admin(auth.uid(), s.mini_league_id)
    )
  );

-- RLS Policies for mini_league_groups
CREATE POLICY "League members can view groups"
  ON public.mini_league_groups FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM mini_league_sessions s
      WHERE s.id = session_id
      AND (is_league_admin(auth.uid(), s.mini_league_id) OR is_league_parent(auth.uid(), s.mini_league_id))
    )
  );

CREATE POLICY "League admins can insert groups"
  ON public.mini_league_groups FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM mini_league_sessions s
      WHERE s.id = session_id
      AND is_league_admin(auth.uid(), s.mini_league_id)
    )
  );

CREATE POLICY "League admins can update groups"
  ON public.mini_league_groups FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM mini_league_sessions s
      WHERE s.id = session_id
      AND is_league_admin(auth.uid(), s.mini_league_id)
    )
  );

CREATE POLICY "League admins can delete groups"
  ON public.mini_league_groups FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM mini_league_sessions s
      WHERE s.id = session_id
      AND is_league_admin(auth.uid(), s.mini_league_id)
    )
  );

-- RLS Policies for mini_league_group_players
CREATE POLICY "League members can view group players"
  ON public.mini_league_group_players FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM mini_league_groups g
      JOIN mini_league_sessions s ON s.id = g.session_id
      WHERE g.id = group_id
      AND (is_league_admin(auth.uid(), s.mini_league_id) OR is_league_parent(auth.uid(), s.mini_league_id))
    )
  );

CREATE POLICY "League admins can insert group players"
  ON public.mini_league_group_players FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM mini_league_groups g
      JOIN mini_league_sessions s ON s.id = g.session_id
      WHERE g.id = group_id
      AND is_league_admin(auth.uid(), s.mini_league_id)
    )
  );

CREATE POLICY "League admins can update group players"
  ON public.mini_league_group_players FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM mini_league_groups g
      JOIN mini_league_sessions s ON s.id = g.session_id
      WHERE g.id = group_id
      AND is_league_admin(auth.uid(), s.mini_league_id)
    )
  );

CREATE POLICY "League admins can delete group players"
  ON public.mini_league_group_players FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM mini_league_groups g
      JOIN mini_league_sessions s ON s.id = g.session_id
      WHERE g.id = group_id
      AND is_league_admin(auth.uid(), s.mini_league_id)
    )
  );

-- Indexes for performance
CREATE INDEX idx_mini_leagues_club_id ON public.mini_leagues(club_id);
CREATE INDEX idx_mini_league_players_league_id ON public.mini_league_players(mini_league_id);
CREATE INDEX idx_mini_league_players_ability ON public.mini_league_players(mini_league_id, ability_rating);
CREATE INDEX idx_mini_league_sessions_league_id ON public.mini_league_sessions(mini_league_id);
CREATE INDEX idx_mini_league_sessions_date ON public.mini_league_sessions(session_date);
CREATE INDEX idx_mini_league_session_availability_session ON public.mini_league_session_availability(session_id);
CREATE INDEX idx_mini_league_groups_session ON public.mini_league_groups(session_id);
CREATE INDEX idx_mini_league_group_players_group ON public.mini_league_group_players(group_id);

-- Trigger for updated_at timestamps
CREATE TRIGGER update_mini_leagues_updated_at
  BEFORE UPDATE ON public.mini_leagues
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_mini_league_players_updated_at
  BEFORE UPDATE ON public.mini_league_players
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_mini_league_sessions_updated_at
  BEFORE UPDATE ON public.mini_league_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_mini_league_session_availability_updated_at
  BEFORE UPDATE ON public.mini_league_session_availability
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_mini_league_groups_updated_at
  BEFORE UPDATE ON public.mini_league_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();