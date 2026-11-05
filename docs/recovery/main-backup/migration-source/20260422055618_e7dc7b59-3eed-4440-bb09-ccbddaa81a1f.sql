-- =========================================================
-- TRAINING MODE — Library-first improvements
-- =========================================================

-- 1) Add is_official flag and extend visibility to allow 'official'
ALTER TABLE public.drills
  ADD COLUMN IF NOT EXISTS is_official BOOLEAN NOT NULL DEFAULT false;

-- Replace visibility check to include 'official'
ALTER TABLE public.drills DROP CONSTRAINT IF EXISTS drills_visibility_check;
ALTER TABLE public.drills
  ADD CONSTRAINT drills_visibility_check
  CHECK (visibility IN ('private','team','club','official'));

CREATE INDEX IF NOT EXISTS idx_drills_official ON public.drills(is_official) WHERE is_official = true;

-- 2) Update can_view_drill to allow ANY signed-in user to view official drills
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
        d.is_official = true
        OR d.owner_user_id = _user_id
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

-- can_edit_drill: only owners & app admins can edit official drills (handled by app_admin branch already)

-- 3) RLS: everyone can SELECT official drills
DROP POLICY IF EXISTS "Drills: anyone views official" ON public.drills;
CREATE POLICY "Drills: anyone views official"
ON public.drills FOR SELECT
TO authenticated
USING (is_official = true);

-- 4) training_session_drills — per-user ordered queue of drills to run today
CREATE TABLE IF NOT EXISTS public.training_session_drills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  drill_id UUID NOT NULL REFERENCES public.drills(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_session_drills_user
  ON public.training_session_drills(user_id, position);

ALTER TABLE public.training_session_drills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Session drills: own select" ON public.training_session_drills;
CREATE POLICY "Session drills: own select"
ON public.training_session_drills FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Session drills: own insert" ON public.training_session_drills;
CREATE POLICY "Session drills: own insert"
ON public.training_session_drills FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Session drills: own update" ON public.training_session_drills;
CREATE POLICY "Session drills: own update"
ON public.training_session_drills FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Session drills: own delete" ON public.training_session_drills;
CREATE POLICY "Session drills: own delete"
ON public.training_session_drills FOR DELETE
USING (auth.uid() = user_id);

-- =========================================================
-- 5) Seed 12 essential Ignite Library drills
-- Owned by system user (all-zero UUID) so they're not tied to a real account.
-- Each drill has 1 simple frame (object positions are illustrative).
-- =========================================================

DO $$
DECLARE
  sys_user UUID := '00000000-0000-0000-0000-000000000000';
  d_id UUID;
BEGIN
  -- Skip if already seeded
  IF EXISTS (SELECT 1 FROM public.drills WHERE is_official = true) THEN
    RETURN;
  END IF;

  -- Helper inline: insert a drill + a single frame
  -- We define a small loop using a temp table of drills
  CREATE TEMP TABLE _seed_drills (
    name TEXT,
    description TEXT,
    age_group TEXT,
    focus TEXT[],
    duration_minutes INT,
    players_required INT,
    equipment TEXT[],
    coaching_points TEXT[],
    objects JSONB,
    annotations JSONB
  ) ON COMMIT DROP;

  INSERT INTO _seed_drills VALUES
  -- 1. Warm-up: Dynamic dribble
  ('Dribble warm-up', 'Each player has a ball and dribbles freely in a 20x20 grid using both feet and changes of direction.',
   'All ages', ARRAY['warm-up','technique','dribbling'], 8, 12,
   ARRAY['1 ball per player','4 cones'],
   ARRAY['Use both feet','Keep head up','Small touches'],
   '[
     {"id":"o1","type":"cone","x":15,"y":15},
     {"id":"o2","type":"cone","x":85,"y":15},
     {"id":"o3","type":"cone","x":15,"y":85},
     {"id":"o4","type":"cone","x":85,"y":85},
     {"id":"o5","type":"player","x":35,"y":40,"label":"1"},
     {"id":"o6","type":"player","x":55,"y":50,"label":"2"},
     {"id":"o7","type":"player","x":45,"y":65,"label":"3"},
     {"id":"o8","type":"ball","x":35,"y":42},
     {"id":"o9","type":"ball","x":55,"y":52},
     {"id":"o10","type":"ball","x":45,"y":67}
   ]'::jsonb,
   '[]'::jsonb),

  -- 2. Passing squares
  ('Passing squares', 'Players pass and follow around a square. Develops short passing and movement.',
   'All ages', ARRAY['passing','technique','movement'], 10, 8,
   ARRAY['1 ball per group','4 cones per square'],
   ARRAY['Pass and follow','Communicate before receiving','Quality first touch'],
   '[
     {"id":"o1","type":"cone","x":25,"y":25},
     {"id":"o2","type":"cone","x":75,"y":25},
     {"id":"o3","type":"cone","x":75,"y":75},
     {"id":"o4","type":"cone","x":25,"y":75},
     {"id":"o5","type":"player","x":25,"y":25,"label":"1"},
     {"id":"o6","type":"player","x":75,"y":25,"label":"2"},
     {"id":"o7","type":"player","x":75,"y":75,"label":"3"},
     {"id":"o8","type":"player","x":25,"y":75,"label":"4"},
     {"id":"o9","type":"ball","x":27,"y":27}
   ]'::jsonb,
   '[
     {"id":"a1","type":"arrow-dashed","geometry":{"from":{"x":28,"y":25},"to":{"x":72,"y":25}}},
     {"id":"a2","type":"arrow-dashed","geometry":{"from":{"x":75,"y":28},"to":{"x":75,"y":72}}},
     {"id":"a3","type":"arrow-dashed","geometry":{"from":{"x":72,"y":75},"to":{"x":28,"y":75}}},
     {"id":"a4","type":"arrow-dashed","geometry":{"from":{"x":25,"y":72},"to":{"x":25,"y":28}}}
   ]'::jsonb),

  -- 3. Rondo 4v1
  ('Rondo 4v1', 'Four attackers in a 10x10 box keep possession from one defender. Switch defender after every interception.',
   'U10+', ARRAY['possession','passing','pressure'], 10, 5,
   ARRAY['1 ball','4 cones'],
   ARRAY['One-touch when possible','Body shape open','Defender presses the ball, not the man'],
   '[
     {"id":"o1","type":"cone","x":25,"y":30},
     {"id":"o2","type":"cone","x":75,"y":30},
     {"id":"o3","type":"cone","x":75,"y":70},
     {"id":"o4","type":"cone","x":25,"y":70},
     {"id":"o5","type":"player","x":30,"y":35,"label":"A","color":"#0ea5e9"},
     {"id":"o6","type":"player","x":70,"y":35,"label":"B","color":"#0ea5e9"},
     {"id":"o7","type":"player","x":70,"y":65,"label":"C","color":"#0ea5e9"},
     {"id":"o8","type":"player","x":30,"y":65,"label":"D","color":"#0ea5e9"},
     {"id":"o9","type":"player","x":50,"y":50,"label":"D","color":"#ef4444"},
     {"id":"o10","type":"ball","x":32,"y":37}
   ]'::jsonb,
   '[]'::jsonb),

  -- 4. 1v1 Attack vs Defend
  ('1v1 to mini-goals', 'Attacker tries to score against a defender in a 15x20 channel with a mini-goal at each end.',
   'U8+', ARRAY['1v1','attacking','defending'], 12, 4,
   ARRAY['1 ball per pair','2 mini-goals','4 cones'],
   ARRAY['Attacker: change of pace','Defender: stay on toes, get goalside','Compete for every ball'],
   '[
     {"id":"o1","type":"mini-goal","x":50,"y":15},
     {"id":"o2","type":"mini-goal","x":50,"y":85},
     {"id":"o3","type":"cone","x":25,"y":30},
     {"id":"o4","type":"cone","x":75,"y":30},
     {"id":"o5","type":"cone","x":25,"y":70},
     {"id":"o6","type":"cone","x":75,"y":70},
     {"id":"o7","type":"player","x":50,"y":35,"label":"A","color":"#0ea5e9"},
     {"id":"o8","type":"player","x":50,"y":65,"label":"D","color":"#ef4444"},
     {"id":"o9","type":"ball","x":50,"y":37}
   ]'::jsonb,
   '[]'::jsonb),

  -- 5. Shooting drill
  ('Shooting circuit', 'Players take turns running onto a layoff pass and shooting first time at goal.',
   'U10+', ARRAY['shooting','finishing'], 15, 6,
   ARRAY['Balls','1 full goal','3 cones'],
   ARRAY['Plant foot beside the ball','Strike through the middle','Follow your shot in'],
   '[
     {"id":"o1","type":"full-goal","x":50,"y":8},
     {"id":"o2","type":"cone","x":50,"y":55},
     {"id":"o3","type":"player","x":50,"y":55,"label":"S","color":"#0ea5e9"},
     {"id":"o4","type":"player","x":35,"y":40,"label":"1","color":"#0ea5e9"},
     {"id":"o5","type":"player","x":35,"y":75,"label":"2","color":"#0ea5e9"},
     {"id":"o6","type":"player","x":35,"y":90,"label":"3","color":"#0ea5e9"},
     {"id":"o7","type":"ball","x":35,"y":77}
   ]'::jsonb,
   '[
     {"id":"a1","type":"arrow-dashed","geometry":{"from":{"x":37,"y":75},"to":{"x":48,"y":55}}},
     {"id":"a2","type":"arrow-solid","geometry":{"from":{"x":50,"y":52},"to":{"x":50,"y":15}}}
   ]'::jsonb),

  -- 6. Small-sided 4v4
  ('4v4 small-sided game', 'Two teams of four play in a 30x40 area with mini-goals. Free play with one rule emphasis (e.g. two-touch).',
   'All ages', ARRAY['game','decision-making','transition'], 15, 8,
   ARRAY['Bibs','1 ball','2 mini-goals','4 cones'],
   ARRAY['Spread out in possession','Press together out of possession','Communicate'],
   '[
     {"id":"o1","type":"mini-goal","x":50,"y":10},
     {"id":"o2","type":"mini-goal","x":50,"y":90},
     {"id":"o3","type":"cone","x":15,"y":20},
     {"id":"o4","type":"cone","x":85,"y":20},
     {"id":"o5","type":"cone","x":15,"y":80},
     {"id":"o6","type":"cone","x":85,"y":80},
     {"id":"o7","type":"player","x":35,"y":30,"label":"1","color":"#0ea5e9"},
     {"id":"o8","type":"player","x":65,"y":30,"label":"2","color":"#0ea5e9"},
     {"id":"o9","type":"player","x":35,"y":50,"label":"3","color":"#0ea5e9"},
     {"id":"o10","type":"player","x":65,"y":50,"label":"4","color":"#0ea5e9"},
     {"id":"o11","type":"player","x":35,"y":60,"label":"1","color":"#ef4444"},
     {"id":"o12","type":"player","x":65,"y":60,"label":"2","color":"#ef4444"},
     {"id":"o13","type":"player","x":35,"y":75,"label":"3","color":"#ef4444"},
     {"id":"o14","type":"player","x":65,"y":75,"label":"4","color":"#ef4444"},
     {"id":"o15","type":"ball","x":50,"y":50}
   ]'::jsonb,
   '[]'::jsonb),

  -- 7. Triangle passing
  ('Triangle passing', 'Three players pass around a triangle then rotate positions. Builds rhythm and movement.',
   'All ages', ARRAY['passing','technique','movement'], 8, 6,
   ARRAY['1 ball per triangle','3 cones'],
   ARRAY['First touch out of feet','Pass with weight','Move after passing'],
   '[
     {"id":"o1","type":"cone","x":50,"y":25},
     {"id":"o2","type":"cone","x":25,"y":75},
     {"id":"o3","type":"cone","x":75,"y":75},
     {"id":"o4","type":"player","x":50,"y":25,"label":"1"},
     {"id":"o5","type":"player","x":25,"y":75,"label":"2"},
     {"id":"o6","type":"player","x":75,"y":75,"label":"3"},
     {"id":"o7","type":"ball","x":52,"y":27}
   ]'::jsonb,
   '[
     {"id":"a1","type":"arrow-dashed","geometry":{"from":{"x":50,"y":28},"to":{"x":28,"y":73}}},
     {"id":"a2","type":"arrow-dashed","geometry":{"from":{"x":28,"y":75},"to":{"x":72,"y":75}}},
     {"id":"a3","type":"arrow-dashed","geometry":{"from":{"x":72,"y":73},"to":{"x":52,"y":28}}}
   ]'::jsonb),

  -- 8. Defensive shape
  ('Defensive shape walk-through', 'Four defenders shift across as a unit in response to ball position. Walking pace, then jogging.',
   'U12+', ARRAY['defending','shape','tactics'], 10, 5,
   ARRAY['1 ball','Cones for reference'],
   ARRAY['Stay compact, no gaps','Distance between defenders ~5m','Press the ball, cover behind'],
   '[
     {"id":"o1","type":"player","x":20,"y":60,"label":"LB","color":"#0ea5e9"},
     {"id":"o2","type":"player","x":40,"y":65,"label":"CB","color":"#0ea5e9"},
     {"id":"o3","type":"player","x":60,"y":65,"label":"CB","color":"#0ea5e9"},
     {"id":"o4","type":"player","x":80,"y":60,"label":"RB","color":"#0ea5e9"},
     {"id":"o5","type":"player","x":80,"y":35,"label":"A","color":"#ef4444"},
     {"id":"o6","type":"ball","x":80,"y":36}
   ]'::jsonb,
   '[
     {"id":"a1","type":"arrow-solid","geometry":{"from":{"x":20,"y":60},"to":{"x":35,"y":60}}},
     {"id":"a2","type":"arrow-solid","geometry":{"from":{"x":40,"y":65},"to":{"x":55,"y":62}}},
     {"id":"a3","type":"arrow-solid","geometry":{"from":{"x":60,"y":65},"to":{"x":72,"y":60}}}
   ]'::jsonb),

  -- 9. Through-ball pattern
  ('Through-ball pattern', 'Midfielder plays a one-two with a forward then slides a through-ball for the runner to finish.',
   'U12+', ARRAY['attacking','passing','combination'], 12, 4,
   ARRAY['Balls','1 full goal','Cones'],
   ARRAY['Disguise the through-ball','Run on the angle, not flat','Finish first time when possible'],
   '[
     {"id":"o1","type":"full-goal","x":50,"y":8},
     {"id":"o2","type":"player","x":40,"y":70,"label":"M","color":"#0ea5e9"},
     {"id":"o3","type":"player","x":50,"y":45,"label":"F","color":"#0ea5e9"},
     {"id":"o4","type":"player","x":65,"y":60,"label":"R","color":"#0ea5e9"},
     {"id":"o5","type":"ball","x":42,"y":72}
   ]'::jsonb,
   '[
     {"id":"a1","type":"arrow-dashed","geometry":{"from":{"x":42,"y":70},"to":{"x":50,"y":47}}},
     {"id":"a2","type":"arrow-dashed","geometry":{"from":{"x":50,"y":47},"to":{"x":40,"y":68}}},
     {"id":"a3","type":"arrow-dashed","geometry":{"from":{"x":40,"y":70},"to":{"x":60,"y":30}}},
     {"id":"a4","type":"arrow-solid","geometry":{"from":{"x":65,"y":60},"to":{"x":58,"y":25}}}
   ]'::jsonb),

  -- 10. Cone slalom
  ('Cone slalom dribble', 'Players dribble through a line of cones using inside and outside of foot, then return.',
   'U6+', ARRAY['technique','dribbling','warm-up'], 6, 8,
   ARRAY['1 ball per player','6 cones in a line'],
   ARRAY['Small touches','Use both surfaces','Look up between touches'],
   '[
     {"id":"o1","type":"cone","x":20,"y":20},
     {"id":"o2","type":"cone","x":35,"y":35},
     {"id":"o3","type":"cone","x":50,"y":50},
     {"id":"o4","type":"cone","x":65,"y":65},
     {"id":"o5","type":"cone","x":80,"y":80},
     {"id":"o6","type":"player","x":15,"y":15,"label":"1"},
     {"id":"o7","type":"ball","x":17,"y":17}
   ]'::jsonb,
   '[
     {"id":"a1","type":"arrow-solid","geometry":{"from":{"x":17,"y":17},"to":{"x":85,"y":85}}}
   ]'::jsonb),

  -- 11. Goalkeeper handling
  ('Goalkeeper handling basics', 'Keeper receives a series of throws and rolls — low, mid, high. Focus on hand shape and footwork.',
   'All ages', ARRAY['goalkeeping','handling','technique'], 10, 2,
   ARRAY['Several balls','1 full goal'],
   ARRAY['W-shape for high balls','Scoop low balls into chest','Move feet to get behind every ball'],
   '[
     {"id":"o1","type":"full-goal","x":50,"y":12},
     {"id":"o2","type":"player","x":50,"y":22,"label":"GK","color":"#22c55e"},
     {"id":"o3","type":"player","x":50,"y":75,"label":"C"},
     {"id":"o4","type":"ball","x":52,"y":77}
   ]'::jsonb,
   '[
     {"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":75},"to":{"x":50,"y":25}}}
   ]'::jsonb),

  -- 12. Cool-down stretch circle
  ('Cool-down circle', 'Players form a circle and follow the leader through a sequence of static stretches. End of session.',
   'All ages', ARRAY['cool-down','recovery'], 5, 12,
   ARRAY['None'],
   ARRAY['Hold each stretch 15-20s','Breathe through the stretch','Talk about the session as you stretch'],
   '[
     {"id":"o1","type":"player","x":50,"y":25,"label":"1"},
     {"id":"o2","type":"player","x":70,"y":35,"label":"2"},
     {"id":"o3","type":"player","x":75,"y":55,"label":"3"},
     {"id":"o4","type":"player","x":65,"y":75,"label":"4"},
     {"id":"o5","type":"player","x":40,"y":75,"label":"5"},
     {"id":"o6","type":"player","x":25,"y":60,"label":"6"},
     {"id":"o7","type":"player","x":25,"y":40,"label":"7"},
     {"id":"o8","type":"player","x":35,"y":25,"label":"8"}
   ]'::jsonb,
   '[]'::jsonb);

  -- Insert each drill + its single frame
  FOR d_id IN
    SELECT NULL::uuid
  LOOP
    -- placeholder so the loop syntax is happy; real loop below
    EXIT;
  END LOOP;

  -- Real insert loop
  FOR d_id IN
    INSERT INTO public.drills (
      owner_user_id, name, description, age_group, focus,
      duration_minutes, players_required, equipment, coaching_points,
      visibility, is_official, pitch_size
    )
    SELECT
      sys_user, name, description, age_group, focus,
      duration_minutes, players_required, equipment, coaching_points,
      'official', true, 'full'
    FROM _seed_drills
    RETURNING id
  LOOP
    -- Insert single frame using same row order — match by name via a join below
    NULL;
  END LOOP;

  -- Easier: insert frames via join on name (re-query)
  INSERT INTO public.drill_frames (drill_id, position, duration_ms, objects, annotations)
  SELECT d.id, 0, 1500, s.objects, s.annotations
  FROM public.drills d
  JOIN _seed_drills s ON s.name = d.name
  WHERE d.is_official = true;
END $$;