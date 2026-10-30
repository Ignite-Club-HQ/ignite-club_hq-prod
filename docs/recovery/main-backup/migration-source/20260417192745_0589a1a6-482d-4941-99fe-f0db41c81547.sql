-- Phase 7: Season-scoped leaderboard support
ALTER TABLE public.points_history
  ADD COLUMN IF NOT EXISTS season_id uuid REFERENCES public.seasons(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_points_history_season_id ON public.points_history(season_id);
CREATE INDEX IF NOT EXISTS idx_points_history_club_created ON public.points_history(club_id, created_at DESC);

-- Trigger: auto-attach season_id from points_history.club_id + created_at
CREATE OR REPLACE FUNCTION public.points_history_attach_season()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.season_id IS NULL AND NEW.club_id IS NOT NULL THEN
    SELECT id INTO NEW.season_id
    FROM public.seasons
    WHERE club_id = NEW.club_id
      AND status IN ('active','closed','archived')
      AND NEW.created_at::date >= COALESCE(start_date, '1900-01-01'::date)
      AND NEW.created_at::date <= COALESCE(end_date, '2999-12-31'::date)
    ORDER BY (status = 'active') DESC, start_date DESC NULLS LAST
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_points_history_attach_season ON public.points_history;
CREATE TRIGGER trg_points_history_attach_season
  BEFORE INSERT ON public.points_history
  FOR EACH ROW EXECUTE FUNCTION public.points_history_attach_season();

-- Backfill existing rows
UPDATE public.points_history ph
SET season_id = s.id
FROM public.seasons s
WHERE ph.season_id IS NULL
  AND ph.club_id = s.club_id
  AND ph.created_at::date >= COALESCE(s.start_date, '1900-01-01'::date)
  AND ph.created_at::date <= COALESCE(s.end_date, '2999-12-31'::date);

-- RPC: Season-scoped leaderboard rank
CREATE OR REPLACE FUNCTION public.get_user_leaderboard_rank_seasoned(
  _user_id uuid,
  _club_id uuid,
  _season_id uuid
) RETURNS TABLE (rank int, total int, points int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _season_filter uuid := _season_id;
BEGIN
  RETURN QUERY
  WITH club_members AS (
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.club_id = _club_id AND ur.user_id IS NOT NULL
    UNION
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    JOIN public.teams t ON t.id = ur.team_id
    WHERE t.club_id = _club_id AND ur.user_id IS NOT NULL
  ),
  totals AS (
    SELECT cm.user_id,
           COALESCE(SUM(ph.amount) FILTER (WHERE ph.amount > 0), 0)::int AS pts
    FROM club_members cm
    LEFT JOIN public.points_history ph
      ON ph.user_id = cm.user_id
     AND ph.club_id = _club_id
     AND (_season_filter IS NULL OR ph.season_id = _season_filter)
    GROUP BY cm.user_id
  ),
  ranked AS (
    SELECT user_id, pts,
           RANK() OVER (ORDER BY pts DESC) AS r,
           COUNT(*) OVER () AS n
    FROM totals
  )
  SELECT r::int, n::int, pts
  FROM ranked
  WHERE user_id = _user_id;
END;
$$;

-- Phase 4 follow-up: Season templates
CREATE OR REPLACE FUNCTION public.create_season_from_template(
  _source_season_id uuid,
  _new_name text,
  _start_date date,
  _end_date date
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _club_id uuid;
  _new_season_id uuid;
BEGIN
  SELECT club_id INTO _club_id FROM public.seasons WHERE id = _source_season_id;
  IF _club_id IS NULL THEN
    RAISE EXCEPTION 'Source season not found';
  END IF;

  -- Permission check: caller must be club admin
  IF NOT public.has_role(auth.uid(), 'app_admin')
     AND NOT EXISTS (
       SELECT 1 FROM public.user_roles
       WHERE user_id = auth.uid()
         AND club_id = _club_id
         AND role IN ('club_admin','committee')
     )
  THEN
    RAISE EXCEPTION 'Not authorised to create seasons for this club';
  END IF;

  INSERT INTO public.seasons (club_id, name, status, start_date, end_date, created_by)
  VALUES (_club_id, _new_name, 'draft', _start_date, _end_date, auth.uid())
  RETURNING id INTO _new_season_id;

  -- Copy teams (name + age_band only), empty rosters
  INSERT INTO public.teams (club_id, name, sport, age_group, season_id, created_by)
  SELECT t.club_id, t.name, t.sport, t.age_group, _new_season_id, auth.uid()
  FROM public.teams t
  WHERE t.season_id = _source_season_id;

  RETURN _new_season_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_leaderboard_rank_seasoned(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_season_from_template(uuid, text, date, date) TO authenticated;