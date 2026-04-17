-- =========================================
-- 1. ENUMS
-- =========================================
CREATE TYPE public.season_status AS ENUM ('draft', 'active', 'closed', 'archived');
CREATE TYPE public.team_lifecycle_status AS ENUM ('draft', 'active', 'archived');
CREATE TYPE public.team_membership_role AS ENUM ('player', 'coach', 'team_admin');
CREATE TYPE public.team_membership_status AS ENUM ('active', 'removed');

-- =========================================
-- 2. SEASONS TABLE
-- =========================================
CREATE TABLE public.seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status public.season_status NOT NULL DEFAULT 'draft',
  start_date DATE,
  end_date DATE,
  archived_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT seasons_name_per_club_unique UNIQUE (club_id, name)
);

CREATE INDEX idx_seasons_club_id ON public.seasons(club_id);
CREATE INDEX idx_seasons_status ON public.seasons(club_id, status);

ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;

-- =========================================
-- 3. CLUB_PLAYERS TABLE (persistent player identity)
-- =========================================
CREATE TABLE public.club_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  child_id UUID REFERENCES public.children(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  date_of_birth DATE,
  preferred_position TEXT,
  medical_notes TEXT,
  contact_notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT club_players_identity_check CHECK (profile_id IS NOT NULL OR child_id IS NOT NULL),
  CONSTRAINT club_players_unique_profile UNIQUE (club_id, profile_id),
  CONSTRAINT club_players_unique_child UNIQUE (club_id, child_id)
);

CREATE INDEX idx_club_players_club_id ON public.club_players(club_id);
CREATE INDEX idx_club_players_profile_id ON public.club_players(profile_id);
CREATE INDEX idx_club_players_child_id ON public.club_players(child_id);

ALTER TABLE public.club_players ENABLE ROW LEVEL SECURITY;

-- =========================================
-- 4. TEAM_MEMBERSHIPS TABLE (season-scoped)
-- =========================================
CREATE TABLE public.team_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_player_id UUID NOT NULL REFERENCES public.club_players(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  season_id UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  role public.team_membership_role NOT NULL DEFAULT 'player',
  status public.team_membership_status NOT NULL DEFAULT 'active',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT team_memberships_unique_per_season UNIQUE (club_player_id, team_id, season_id)
);

CREATE INDEX idx_team_memberships_team_season ON public.team_memberships(team_id, season_id);
CREATE INDEX idx_team_memberships_player ON public.team_memberships(club_player_id);
CREATE INDEX idx_team_memberships_season ON public.team_memberships(season_id);

ALTER TABLE public.team_memberships ENABLE ROW LEVEL SECURITY;

-- =========================================
-- 5. EXTEND TEAMS + CLUBS
-- (teams already has is_archived + archived_at — reusing those)
-- =========================================
ALTER TABLE public.teams
  ADD COLUMN season_id UUID REFERENCES public.seasons(id) ON DELETE SET NULL,
  ADD COLUMN lifecycle_status public.team_lifecycle_status NOT NULL DEFAULT 'active';

CREATE INDEX idx_teams_season_id ON public.teams(season_id);
CREATE INDEX idx_teams_lifecycle_status ON public.teams(club_id, lifecycle_status);

ALTER TABLE public.clubs
  ADD COLUMN current_season_id UUID REFERENCES public.seasons(id) ON DELETE SET NULL;

-- =========================================
-- 6. BACKFILL: create one Active season per club, link existing (non-deleted) teams
-- =========================================
DO $$
DECLARE
  club_rec RECORD;
  new_season_id UUID;
BEGIN
  FOR club_rec IN SELECT id FROM public.clubs WHERE deleted_at IS NULL LOOP
    INSERT INTO public.seasons (club_id, name, status, start_date)
    VALUES (club_rec.id, 'Current Season', 'active', CURRENT_DATE)
    RETURNING id INTO new_season_id;

    UPDATE public.teams
    SET season_id = new_season_id
    WHERE club_id = club_rec.id AND season_id IS NULL;

    -- Mark already-archived teams as lifecycle_status = 'archived'
    UPDATE public.teams
    SET lifecycle_status = 'archived'
    WHERE club_id = club_rec.id AND is_archived = true;

    UPDATE public.clubs
    SET current_season_id = new_season_id
    WHERE id = club_rec.id;
  END LOOP;
END $$;

-- =========================================
-- 7. HELPER FUNCTIONS (only ones not already present)
-- (has_role, is_club_member, update_updated_at_column already exist)
-- =========================================

-- Check if a user is a club admin (or app admin)
CREATE OR REPLACE FUNCTION public.is_club_admin(_user_id UUID, _club_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'app_admin'
  ) OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND club_id = _club_id
      AND role = 'club_admin'
  );
$$;

-- Check if a user can manage a team's roster (app admin, club admin, team admin of that team, or coach of that team)
CREATE OR REPLACE FUNCTION public.can_manage_team_roster(_user_id UUID, _team_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur, public.teams t
    WHERE t.id = _team_id
      AND ur.user_id = _user_id
      AND (
        ur.role = 'app_admin'
        OR (ur.club_id = t.club_id AND ur.role = 'club_admin')
        OR (ur.team_id = _team_id AND ur.role IN ('team_admin', 'coach'))
      )
  );
$$;

-- Check if a season is editable (not archived/closed)
CREATE OR REPLACE FUNCTION public.is_season_editable(_season_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.seasons
    WHERE id = _season_id
      AND status IN ('draft', 'active')
  );
$$;

-- =========================================
-- 8. RLS POLICIES — SEASONS
-- =========================================
CREATE POLICY "Club members can view seasons"
ON public.seasons FOR SELECT
TO authenticated
USING (public.is_club_member(auth.uid(), club_id) OR public.has_role(auth.uid(), 'app_admin'));

CREATE POLICY "Club admins can create seasons"
ON public.seasons FOR INSERT
TO authenticated
WITH CHECK (public.is_club_admin(auth.uid(), club_id));

CREATE POLICY "Club admins can update seasons"
ON public.seasons FOR UPDATE
TO authenticated
USING (public.is_club_admin(auth.uid(), club_id))
WITH CHECK (public.is_club_admin(auth.uid(), club_id));

CREATE POLICY "Club admins can delete draft seasons"
ON public.seasons FOR DELETE
TO authenticated
USING (public.is_club_admin(auth.uid(), club_id) AND status = 'draft');

-- =========================================
-- 9. RLS POLICIES — CLUB_PLAYERS
-- =========================================
CREATE POLICY "Club members can view club players"
ON public.club_players FOR SELECT
TO authenticated
USING (public.is_club_member(auth.uid(), club_id) OR public.has_role(auth.uid(), 'app_admin'));

CREATE POLICY "Club admins and coaches can create club players"
ON public.club_players FOR INSERT
TO authenticated
WITH CHECK (
  public.is_club_admin(auth.uid(), club_id)
  OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND club_id = public.club_players.club_id
      AND role IN ('team_admin', 'coach')
  )
);

CREATE POLICY "Club admins and coaches can update club players"
ON public.club_players FOR UPDATE
TO authenticated
USING (
  public.is_club_admin(auth.uid(), club_id)
  OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND club_id = public.club_players.club_id
      AND role IN ('team_admin', 'coach')
  )
);

CREATE POLICY "Club admins can delete club players"
ON public.club_players FOR DELETE
TO authenticated
USING (public.is_club_admin(auth.uid(), club_id));

-- =========================================
-- 10. RLS POLICIES — TEAM_MEMBERSHIPS
-- =========================================
CREATE POLICY "Club members can view team memberships"
ON public.team_memberships FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = public.team_memberships.team_id
      AND (public.is_club_member(auth.uid(), t.club_id) OR public.has_role(auth.uid(), 'app_admin'))
  )
);

CREATE POLICY "Roster managers can create memberships in editable seasons"
ON public.team_memberships FOR INSERT
TO authenticated
WITH CHECK (
  public.can_manage_team_roster(auth.uid(), team_id)
  AND public.is_season_editable(season_id)
);

CREATE POLICY "Roster managers can update memberships in editable seasons"
ON public.team_memberships FOR UPDATE
TO authenticated
USING (
  public.can_manage_team_roster(auth.uid(), team_id)
  AND public.is_season_editable(season_id)
);

CREATE POLICY "Roster managers can delete memberships in editable seasons"
ON public.team_memberships FOR DELETE
TO authenticated
USING (
  public.can_manage_team_roster(auth.uid(), team_id)
  AND public.is_season_editable(season_id)
);

-- =========================================
-- 11. TIMESTAMP TRIGGERS
-- =========================================
CREATE TRIGGER update_seasons_updated_at
  BEFORE UPDATE ON public.seasons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_club_players_updated_at
  BEFORE UPDATE ON public.club_players
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_team_memberships_updated_at
  BEFORE UPDATE ON public.team_memberships
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- 12. RPC: archive_season
-- =========================================
CREATE OR REPLACE FUNCTION public.archive_season(_season_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _club_id UUID;
BEGIN
  SELECT club_id INTO _club_id FROM public.seasons WHERE id = _season_id;
  IF _club_id IS NULL THEN
    RAISE EXCEPTION 'Season not found';
  END IF;

  IF NOT public.is_club_admin(auth.uid(), _club_id) THEN
    RAISE EXCEPTION 'Only club admins can archive seasons';
  END IF;

  UPDATE public.seasons
  SET status = 'archived', archived_at = now()
  WHERE id = _season_id;

  UPDATE public.teams
  SET lifecycle_status = 'archived',
      is_archived = true,
      archived_at = COALESCE(archived_at, now())
  WHERE season_id = _season_id;

  UPDATE public.clubs
  SET current_season_id = NULL
  WHERE current_season_id = _season_id;
END;
$$;

-- =========================================
-- 13. RPC: publish_season
-- =========================================
CREATE OR REPLACE FUNCTION public.publish_season(_season_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _club_id UUID;
BEGIN
  SELECT club_id INTO _club_id FROM public.seasons WHERE id = _season_id;
  IF _club_id IS NULL THEN
    RAISE EXCEPTION 'Season not found';
  END IF;

  IF NOT public.is_club_admin(auth.uid(), _club_id) THEN
    RAISE EXCEPTION 'Only club admins can publish seasons';
  END IF;

  UPDATE public.seasons
  SET status = 'active'
  WHERE id = _season_id AND status = 'draft';

  UPDATE public.teams
  SET lifecycle_status = 'active'
  WHERE season_id = _season_id AND lifecycle_status = 'draft';

  UPDATE public.clubs
  SET current_season_id = _season_id
  WHERE id = _club_id;
END;
$$;

-- =========================================
-- 14. RPC: duplicate_season_structure (no players carried over)
-- =========================================
CREATE OR REPLACE FUNCTION public.duplicate_season_structure(
  _source_season_id UUID,
  _new_season_name TEXT,
  _copy_staff BOOLEAN DEFAULT true
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _club_id UUID;
  _new_season_id UUID;
  _team_rec RECORD;
  _new_team_id UUID;
BEGIN
  SELECT club_id INTO _club_id FROM public.seasons WHERE id = _source_season_id;
  IF _club_id IS NULL THEN
    RAISE EXCEPTION 'Source season not found';
  END IF;

  IF NOT public.is_club_admin(auth.uid(), _club_id) THEN
    RAISE EXCEPTION 'Only club admins can create seasons';
  END IF;

  INSERT INTO public.seasons (club_id, name, status, created_by)
  VALUES (_club_id, _new_season_name, 'draft', auth.uid())
  RETURNING id INTO _new_season_id;

  FOR _team_rec IN
    SELECT id, name, level_age, team_type, club_id, default_pitch_format, default_formation
    FROM public.teams
    WHERE season_id = _source_season_id
      AND COALESCE(is_archived, false) = false
  LOOP
    INSERT INTO public.teams (
      club_id, name, level_age, team_type, season_id, lifecycle_status,
      default_pitch_format, default_formation, created_by
    )
    VALUES (
      _team_rec.club_id, _team_rec.name, _team_rec.level_age, _team_rec.team_type,
      _new_season_id, 'draft',
      _team_rec.default_pitch_format, _team_rec.default_formation, auth.uid()
    )
    RETURNING id INTO _new_team_id;

    IF _copy_staff THEN
      INSERT INTO public.user_roles (user_id, role, team_id, club_id)
      SELECT DISTINCT user_id, role, _new_team_id, _team_rec.club_id
      FROM public.user_roles
      WHERE team_id = _team_rec.id
        AND role IN ('team_admin', 'coach')
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  RETURN _new_season_id;
END;
$$;