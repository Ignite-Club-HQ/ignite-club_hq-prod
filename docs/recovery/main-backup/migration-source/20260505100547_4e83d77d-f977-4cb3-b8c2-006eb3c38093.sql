
CREATE TABLE IF NOT EXISTS public.user_club_points (
  user_id uuid NOT NULL,
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  points integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, club_id)
);

CREATE TABLE IF NOT EXISTS public.child_club_points (
  child_id uuid NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  points integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (child_id, club_id)
);

CREATE INDEX IF NOT EXISTS idx_user_club_points_club ON public.user_club_points(club_id);
CREATE INDEX IF NOT EXISTS idx_child_club_points_club ON public.child_club_points(club_id);

ALTER TABLE public.user_club_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.child_club_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own club points"
  ON public.user_club_points FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Parents view children club points"
  ON public.child_club_points FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.children c WHERE c.id = child_club_points.child_id AND c.parent_id = auth.uid())
  );

CREATE POLICY "Club staff view club user points"
  ON public.user_club_points FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'app_admin')
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.club_id = user_club_points.club_id
        AND ur.role IN ('club_admin', 'coach', 'team_admin')
    )
  );

CREATE POLICY "Club staff view club child points"
  ON public.child_club_points FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'app_admin')
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.club_id = child_club_points.club_id
        AND ur.role IN ('club_admin', 'coach', 'team_admin')
    )
  );

CREATE OR REPLACE FUNCTION public.increment_user_club_points(
  _user_id uuid, _club_id uuid, _amount integer
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_total integer;
BEGIN
  IF _user_id IS NULL OR _club_id IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.user_club_points(user_id, club_id, points, updated_at)
  VALUES (_user_id, _club_id, GREATEST(0, _amount), now())
  ON CONFLICT (user_id, club_id) DO UPDATE
    SET points = GREATEST(0, public.user_club_points.points + _amount),
        updated_at = now()
  RETURNING points INTO new_total;
  RETURN new_total;
END; $$;

CREATE OR REPLACE FUNCTION public.increment_child_club_points(
  _child_id uuid, _club_id uuid, _amount integer
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_total integer;
BEGIN
  IF _child_id IS NULL OR _club_id IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.child_club_points(child_id, club_id, points, updated_at)
  VALUES (_child_id, _club_id, GREATEST(0, _amount), now())
  ON CONFLICT (child_id, club_id) DO UPDATE
    SET points = GREATEST(0, public.child_club_points.points + _amount),
        updated_at = now()
  RETURNING points INTO new_total;
  RETURN new_total;
END; $$;

CREATE OR REPLACE FUNCTION public.get_user_club_points(_user_id uuid, _club_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT points FROM public.user_club_points WHERE user_id = _user_id AND club_id = _club_id), 0);
$$;

CREATE OR REPLACE FUNCTION public.get_child_club_points(_child_id uuid, _club_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT points FROM public.child_club_points WHERE child_id = _child_id AND club_id = _club_id), 0);
$$;

GRANT EXECUTE ON FUNCTION public.increment_user_club_points(uuid, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_child_club_points(uuid, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_club_points(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_child_club_points(uuid, uuid) TO authenticated, service_role;

-- Backfill: users → primary club
WITH role_counts AS (
  SELECT user_id, club_id, COUNT(*)::int AS role_count, MIN(created_at) AS first_join
  FROM public.user_roles WHERE club_id IS NOT NULL
  GROUP BY user_id, club_id
),
user_primary AS (
  SELECT DISTINCT ON (user_id) user_id, club_id
  FROM role_counts ORDER BY user_id, role_count DESC, first_join ASC NULLS LAST
)
INSERT INTO public.user_club_points(user_id, club_id, points)
SELECT p.id, up.club_id, COALESCE(p.ignite_points, 0)
FROM public.profiles p JOIN user_primary up ON up.user_id = p.id
WHERE COALESCE(p.ignite_points, 0) > 0
ON CONFLICT (user_id, club_id) DO NOTHING;

-- Backfill: children → primary club via child_team_assignments → teams.club_id
WITH team_counts AS (
  SELECT cta.child_id, t.club_id, COUNT(*)::int AS team_count, MIN(cta.created_at) AS first_join
  FROM public.child_team_assignments cta
  JOIN public.teams t ON t.id = cta.team_id
  WHERE t.club_id IS NOT NULL
  GROUP BY cta.child_id, t.club_id
),
child_primary AS (
  SELECT DISTINCT ON (child_id) child_id, club_id
  FROM team_counts ORDER BY child_id, team_count DESC, first_join ASC NULLS LAST
)
INSERT INTO public.child_club_points(child_id, club_id, points)
SELECT c.id, cp.club_id, COALESCE(c.ignite_points, 0)
FROM public.children c JOIN child_primary cp ON cp.child_id = c.id
WHERE COALESCE(c.ignite_points, 0) > 0
ON CONFLICT (child_id, club_id) DO NOTHING;
