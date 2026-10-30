
-- 1. Linking columns on clubs + teams
ALTER TABLE public.clubs
  ADD COLUMN IF NOT EXISTS playhq_org_id text,
  ADD COLUMN IF NOT EXISTS playhq_tenant text;

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS playhq_team_id text,
  ADD COLUMN IF NOT EXISTS playhq_grade_id text,
  ADD COLUMN IF NOT EXISTS playhq_season_id text,
  ADD COLUMN IF NOT EXISTS playhq_auto_create_events boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_teams_playhq_grade ON public.teams(playhq_grade_id) WHERE playhq_grade_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clubs_playhq_org ON public.clubs(playhq_org_id) WHERE playhq_org_id IS NOT NULL;

-- 2. playhq_grades
CREATE TABLE IF NOT EXISTS public.playhq_grades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playhq_grade_id text NOT NULL UNIQUE,
  playhq_season_id text,
  playhq_competition_id text,
  tenant text NOT NULL,
  name text NOT NULL,
  sport text,
  raw jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.playhq_grades TO authenticated, anon;
GRANT ALL ON public.playhq_grades TO service_role;
ALTER TABLE public.playhq_grades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "playhq_grades public read" ON public.playhq_grades FOR SELECT USING (true);
CREATE POLICY "playhq_grades service write" ON public.playhq_grades FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. playhq_fixtures
CREATE TABLE IF NOT EXISTS public.playhq_fixtures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playhq_game_id text NOT NULL UNIQUE,
  playhq_grade_id text NOT NULL,
  scheduled_at timestamptz,
  status text,
  round text,
  venue_name text,
  venue_address text,
  court text,
  home_playhq_team_id text,
  home_team_name text,
  home_score integer,
  away_playhq_team_id text,
  away_team_name text,
  away_score integer,
  raw jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_playhq_fixtures_grade ON public.playhq_fixtures(playhq_grade_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_playhq_fixtures_home_team ON public.playhq_fixtures(home_playhq_team_id);
CREATE INDEX IF NOT EXISTS idx_playhq_fixtures_away_team ON public.playhq_fixtures(away_playhq_team_id);
GRANT SELECT ON public.playhq_fixtures TO authenticated, anon;
GRANT ALL ON public.playhq_fixtures TO service_role;
ALTER TABLE public.playhq_fixtures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "playhq_fixtures public read" ON public.playhq_fixtures FOR SELECT USING (true);
CREATE POLICY "playhq_fixtures service write" ON public.playhq_fixtures FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. playhq_ladder
CREATE TABLE IF NOT EXISTS public.playhq_ladder (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playhq_grade_id text NOT NULL,
  playhq_team_id text NOT NULL,
  team_name text NOT NULL,
  position integer,
  played integer NOT NULL DEFAULT 0,
  wins integer NOT NULL DEFAULT 0,
  draws integer NOT NULL DEFAULT 0,
  losses integer NOT NULL DEFAULT 0,
  points integer NOT NULL DEFAULT 0,
  points_for integer NOT NULL DEFAULT 0,
  points_against integer NOT NULL DEFAULT 0,
  points_diff integer NOT NULL DEFAULT 0,
  raw jsonb,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (playhq_grade_id, playhq_team_id)
);
CREATE INDEX IF NOT EXISTS idx_playhq_ladder_grade ON public.playhq_ladder(playhq_grade_id, position);
GRANT SELECT ON public.playhq_ladder TO authenticated, anon;
GRANT ALL ON public.playhq_ladder TO service_role;
ALTER TABLE public.playhq_ladder ENABLE ROW LEVEL SECURITY;
CREATE POLICY "playhq_ladder public read" ON public.playhq_ladder FOR SELECT USING (true);
CREATE POLICY "playhq_ladder service write" ON public.playhq_ladder FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. playhq_player_stats
CREATE TABLE IF NOT EXISTS public.playhq_player_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playhq_game_id text NOT NULL,
  playhq_team_id text NOT NULL,
  playhq_player_id text NOT NULL,
  player_name text,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (playhq_game_id, playhq_player_id)
);
CREATE INDEX IF NOT EXISTS idx_playhq_player_stats_game ON public.playhq_player_stats(playhq_game_id);
CREATE INDEX IF NOT EXISTS idx_playhq_player_stats_team ON public.playhq_player_stats(playhq_team_id);
GRANT SELECT ON public.playhq_player_stats TO authenticated, anon;
GRANT ALL ON public.playhq_player_stats TO service_role;
ALTER TABLE public.playhq_player_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "playhq_player_stats public read" ON public.playhq_player_stats FOR SELECT USING (true);
CREATE POLICY "playhq_player_stats service write" ON public.playhq_player_stats FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 6. playhq_sync_log
CREATE TABLE IF NOT EXISTS public.playhq_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playhq_grade_id text NOT NULL,
  tenant text NOT NULL,
  status text NOT NULL,
  fixtures_synced integer NOT NULL DEFAULT 0,
  ladder_rows integer NOT NULL DEFAULT 0,
  stat_rows integer NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_playhq_sync_log_grade ON public.playhq_sync_log(playhq_grade_id, started_at DESC);
GRANT SELECT ON public.playhq_sync_log TO authenticated;
GRANT ALL ON public.playhq_sync_log TO service_role;
ALTER TABLE public.playhq_sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "playhq_sync_log read" ON public.playhq_sync_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "playhq_sync_log service write" ON public.playhq_sync_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 7. updated_at triggers
CREATE OR REPLACE FUNCTION public.playhq_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_playhq_grades_updated ON public.playhq_grades;
CREATE TRIGGER trg_playhq_grades_updated BEFORE UPDATE ON public.playhq_grades
  FOR EACH ROW EXECUTE FUNCTION public.playhq_touch_updated_at();

DROP TRIGGER IF EXISTS trg_playhq_fixtures_updated ON public.playhq_fixtures;
CREATE TRIGGER trg_playhq_fixtures_updated BEFORE UPDATE ON public.playhq_fixtures
  FOR EACH ROW EXECUTE FUNCTION public.playhq_touch_updated_at();

DROP TRIGGER IF EXISTS trg_playhq_player_stats_updated ON public.playhq_player_stats;
CREATE TRIGGER trg_playhq_player_stats_updated BEFORE UPDATE ON public.playhq_player_stats
  FOR EACH ROW EXECUTE FUNCTION public.playhq_touch_updated_at();
