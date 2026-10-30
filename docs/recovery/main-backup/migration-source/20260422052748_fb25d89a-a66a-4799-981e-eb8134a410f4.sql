-- =========================================================
-- TRAINING MODE — Drill persistence (Phase 3)
-- =========================================================

CREATE TABLE IF NOT EXISTS public.drills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  club_id UUID REFERENCES public.clubs(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  age_group TEXT,
  focus TEXT[] NOT NULL DEFAULT '{}',
  duration_minutes INT,
  players_required INT,
  equipment TEXT[] NOT NULL DEFAULT '{}',
  coaching_points TEXT[] NOT NULL DEFAULT '{}',
  progression TEXT,
  regression TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  visibility TEXT NOT NULL DEFAULT 'private',
  pitch_size TEXT NOT NULL DEFAULT 'full',
  thumbnail_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT drills_visibility_check CHECK (visibility IN ('private','team','club'))
);

CREATE INDEX IF NOT EXISTS idx_drills_owner ON public.drills(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_drills_team ON public.drills(team_id) WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drills_club ON public.drills(club_id) WHERE club_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drills_visibility ON public.drills(visibility);

CREATE TABLE IF NOT EXISTS public.drill_frames (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drill_id UUID NOT NULL REFERENCES public.drills(id) ON DELETE CASCADE,
  position INT NOT NULL,
  duration_ms INT NOT NULL DEFAULT 1500,
  notes TEXT,
  objects JSONB NOT NULL DEFAULT '[]'::jsonb,
  annotations JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (drill_id, position)
);

CREATE INDEX IF NOT EXISTS idx_drill_frames_drill ON public.drill_frames(drill_id, position);

CREATE TABLE IF NOT EXISTS public.drill_recent_uses (
  user_id UUID NOT NULL,
  drill_id UUID NOT NULL REFERENCES public.drills(id) ON DELETE CASCADE,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, drill_id)
);

CREATE INDEX IF NOT EXISTS idx_drill_recent_user ON public.drill_recent_uses(user_id, last_used_at DESC);

-- ---------- Updated-at triggers ----------
DROP TRIGGER IF EXISTS update_drills_updated_at ON public.drills;
CREATE TRIGGER update_drills_updated_at
BEFORE UPDATE ON public.drills
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_drill_frames_updated_at ON public.drill_frames;
CREATE TRIGGER update_drill_frames_updated_at
BEFORE UPDATE ON public.drill_frames
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- Access helpers (SECURITY DEFINER) ----------

CREATE OR REPLACE FUNCTION public.can_edit_drill(_drill_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.drills d
    WHERE d.id = _drill_id
      AND (
        d.owner_user_id = _user_id
        OR public.has_role(_user_id, 'app_admin'::app_role)
        OR (
          d.visibility = 'team'
          AND d.team_id IS NOT NULL
          AND (
            public.has_role(_user_id, 'coach'::app_role, NULL, d.team_id)
            OR public.has_role(_user_id, 'team_admin'::app_role, NULL, d.team_id)
          )
        )
        OR (
          d.visibility = 'club'
          AND d.club_id IS NOT NULL
          AND public.has_role(_user_id, 'club_admin'::app_role, d.club_id, NULL)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_drill(_drill_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.drills d
    WHERE d.id = _drill_id
      AND (
        d.owner_user_id = _user_id
        OR public.has_role(_user_id, 'app_admin'::app_role)
        OR (
          d.visibility = 'team'
          AND d.team_id IS NOT NULL
          AND public.is_team_member(_user_id, d.team_id)
        )
        OR (
          d.visibility = 'club'
          AND d.club_id IS NOT NULL
          AND public.is_club_member(_user_id, d.club_id)
        )
      )
  );
$$;

-- ---------- RLS ----------

ALTER TABLE public.drills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drill_frames ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drill_recent_uses ENABLE ROW LEVEL SECURITY;

-- ----- drills -----
DROP POLICY IF EXISTS "Drills: owners view own" ON public.drills;
CREATE POLICY "Drills: owners view own"
ON public.drills FOR SELECT
USING (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS "Drills: team members view team drills" ON public.drills;
CREATE POLICY "Drills: team members view team drills"
ON public.drills FOR SELECT
USING (
  visibility = 'team'
  AND team_id IS NOT NULL
  AND public.is_team_member(auth.uid(), team_id)
);

DROP POLICY IF EXISTS "Drills: club members view club drills" ON public.drills;
CREATE POLICY "Drills: club members view club drills"
ON public.drills FOR SELECT
USING (
  visibility = 'club'
  AND club_id IS NOT NULL
  AND public.is_club_member(auth.uid(), club_id)
);

DROP POLICY IF EXISTS "Drills: app admins view all" ON public.drills;
CREATE POLICY "Drills: app admins view all"
ON public.drills FOR SELECT
USING (public.has_role(auth.uid(), 'app_admin'::app_role));

DROP POLICY IF EXISTS "Drills: owners insert own" ON public.drills;
CREATE POLICY "Drills: owners insert own"
ON public.drills FOR INSERT
WITH CHECK (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS "Drills: editors update" ON public.drills;
CREATE POLICY "Drills: editors update"
ON public.drills FOR UPDATE
USING (public.can_edit_drill(id, auth.uid()))
WITH CHECK (public.can_edit_drill(id, auth.uid()));

DROP POLICY IF EXISTS "Drills: editors delete" ON public.drills;
CREATE POLICY "Drills: editors delete"
ON public.drills FOR DELETE
USING (public.can_edit_drill(id, auth.uid()));

-- ----- drill_frames -----
DROP POLICY IF EXISTS "Frames: viewers select" ON public.drill_frames;
CREATE POLICY "Frames: viewers select"
ON public.drill_frames FOR SELECT
USING (public.can_view_drill(drill_id, auth.uid()));

DROP POLICY IF EXISTS "Frames: editors insert" ON public.drill_frames;
CREATE POLICY "Frames: editors insert"
ON public.drill_frames FOR INSERT
WITH CHECK (public.can_edit_drill(drill_id, auth.uid()));

DROP POLICY IF EXISTS "Frames: editors update" ON public.drill_frames;
CREATE POLICY "Frames: editors update"
ON public.drill_frames FOR UPDATE
USING (public.can_edit_drill(drill_id, auth.uid()))
WITH CHECK (public.can_edit_drill(drill_id, auth.uid()));

DROP POLICY IF EXISTS "Frames: editors delete" ON public.drill_frames;
CREATE POLICY "Frames: editors delete"
ON public.drill_frames FOR DELETE
USING (public.can_edit_drill(drill_id, auth.uid()));

-- ----- drill_recent_uses -----
DROP POLICY IF EXISTS "Recent: own select" ON public.drill_recent_uses;
CREATE POLICY "Recent: own select"
ON public.drill_recent_uses FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Recent: own insert" ON public.drill_recent_uses;
CREATE POLICY "Recent: own insert"
ON public.drill_recent_uses FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Recent: own update" ON public.drill_recent_uses;
CREATE POLICY "Recent: own update"
ON public.drill_recent_uses FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Recent: own delete" ON public.drill_recent_uses;
CREATE POLICY "Recent: own delete"
ON public.drill_recent_uses FOR DELETE
USING (auth.uid() = user_id);
