-- =========================================================
-- Fix 4 existing seeded drills + add 10 new FA-inspired drills
-- Coordinate system: 0-100, y=0 top of pitch (top goal), y=100 bottom (bottom goal)
-- =========================================================

DO $$
DECLARE
  sys_user UUID := '00000000-0000-0000-0000-000000000000';
BEGIN

-- =========================================================
-- PART 1: Fix existing drills
-- =========================================================

-- Fix #3 Rondo 4v1: rename middle defender from "D" to "X" so it doesn't clash with attacker D
UPDATE public.drill_frames
SET objects = '[
   {"id":"o1","type":"cone","x":25,"y":30},
   {"id":"o2","type":"cone","x":75,"y":30},
   {"id":"o3","type":"cone","x":75,"y":70},
   {"id":"o4","type":"cone","x":25,"y":70},
   {"id":"o5","type":"player","x":30,"y":35,"label":"A","color":"#0ea5e9"},
   {"id":"o6","type":"player","x":70,"y":35,"label":"B","color":"#0ea5e9"},
   {"id":"o7","type":"player","x":70,"y":65,"label":"C","color":"#0ea5e9"},
   {"id":"o8","type":"player","x":30,"y":65,"label":"D","color":"#0ea5e9"},
   {"id":"o9","type":"player","x":50,"y":50,"label":"X","color":"#ef4444"},
   {"id":"o10","type":"ball","x":32,"y":37}
 ]'::jsonb
WHERE drill_id = (SELECT id FROM public.drills WHERE name = 'Rondo 4v1' AND is_official = true LIMIT 1);

-- Fix #5 Shooting circuit: tidy queue, clear server position, proper layoff arrows
UPDATE public.drill_frames
SET objects = '[
   {"id":"o1","type":"full-goal","x":50,"y":8},
   {"id":"o2","type":"cone","x":35,"y":75},
   {"id":"o3","type":"player","x":65,"y":50,"label":"S","color":"#0ea5e9"},
   {"id":"o4","type":"player","x":35,"y":75,"label":"1","color":"#0ea5e9"},
   {"id":"o5","type":"player","x":35,"y":82,"label":"2","color":"#0ea5e9"},
   {"id":"o6","type":"player","x":35,"y":89,"label":"3","color":"#0ea5e9"},
   {"id":"o7","type":"ball","x":37,"y":75}
 ]'::jsonb,
 annotations = '[
   {"id":"a1","type":"arrow-dashed","geometry":{"from":{"x":37,"y":75},"to":{"x":63,"y":50}}},
   {"id":"a2","type":"arrow-dashed","geometry":{"from":{"x":63,"y":50},"to":{"x":52,"y":35}}},
   {"id":"a3","type":"arrow-solid","geometry":{"from":{"x":40,"y":70},"to":{"x":50,"y":35}}},
   {"id":"a4","type":"arrow-solid","geometry":{"from":{"x":50,"y":35},"to":{"x":50,"y":12}}}
 ]'::jsonb
WHERE drill_id = (SELECT id FROM public.drills WHERE name = 'Shooting circuit' AND is_official = true LIMIT 1);

-- Fix #9 Through-ball pattern: position runner wide and deep so the through-ball makes sense
UPDATE public.drill_frames
SET objects = '[
   {"id":"o1","type":"full-goal","x":50,"y":8},
   {"id":"o2","type":"player","x":40,"y":75,"label":"M","color":"#0ea5e9"},
   {"id":"o3","type":"player","x":50,"y":50,"label":"F","color":"#0ea5e9"},
   {"id":"o4","type":"player","x":75,"y":65,"label":"R","color":"#0ea5e9"},
   {"id":"o5","type":"ball","x":42,"y":77}
 ]'::jsonb,
 annotations = '[
   {"id":"a1","type":"arrow-dashed","geometry":{"from":{"x":42,"y":75},"to":{"x":50,"y":52}}},
   {"id":"a2","type":"arrow-dashed","geometry":{"from":{"x":50,"y":52},"to":{"x":42,"y":72}}},
   {"id":"a3","type":"arrow-dashed","geometry":{"from":{"x":40,"y":72},"to":{"x":72,"y":30}}},
   {"id":"a4","type":"arrow-solid","geometry":{"from":{"x":75,"y":62},"to":{"x":72,"y":28}}}
 ]'::jsonb
WHERE drill_id = (SELECT id FROM public.drills WHERE name = 'Through-ball pattern' AND is_official = true LIMIT 1);

-- Fix #10 Cone slalom: cones in a straight vertical line, player starts at bottom, weaving arrow
UPDATE public.drill_frames
SET objects = '[
   {"id":"o1","type":"cone","x":50,"y":25},
   {"id":"o2","type":"cone","x":50,"y":37},
   {"id":"o3","type":"cone","x":50,"y":49},
   {"id":"o4","type":"cone","x":50,"y":61},
   {"id":"o5","type":"cone","x":50,"y":73},
   {"id":"o6","type":"player","x":50,"y":85,"label":"1"},
   {"id":"o7","type":"ball","x":52,"y":85}
 ]'::jsonb,
 annotations = '[
   {"id":"a1","type":"arrow-solid","geometry":{"from":{"x":52,"y":83},"to":{"x":42,"y":73}}},
   {"id":"a2","type":"arrow-solid","geometry":{"from":{"x":42,"y":73},"to":{"x":58,"y":61}}},
   {"id":"a3","type":"arrow-solid","geometry":{"from":{"x":58,"y":61},"to":{"x":42,"y":49}}},
   {"id":"a4","type":"arrow-solid","geometry":{"from":{"x":42,"y":49},"to":{"x":58,"y":37}}},
   {"id":"a5","type":"arrow-solid","geometry":{"from":{"x":58,"y":37},"to":{"x":50,"y":20}}}
 ]'::jsonb
WHERE drill_id = (SELECT id FROM public.drills WHERE name = 'Cone slalom dribble' AND is_official = true LIMIT 1);

-- =========================================================
-- PART 2: Add 10 new Football Australia-inspired drills
-- Source: footballaustralia.com.au/coaching-resources Sessions 1–20
-- =========================================================

CREATE TEMP TABLE _new_seed_drills (
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

INSERT INTO _new_seed_drills VALUES

-- 1. FA Session 1 — Dribbling under pressure (gates)
('Dribble gates', 'Players dribble freely in a 25x25 area and try to dribble through as many "gates" (pairs of cones) as possible in 60 seconds. Add a defender to apply pressure.',
 'U7-U10', ARRAY['dribbling','technique','pressure'], 10, 8,
 ARRAY['1 ball per player','12 cones (6 gates)'],
 ARRAY['Head up to spot the next gate','Change direction to escape pressure','Use both feet','Quality over quantity'],
 '[
   {"id":"o1","type":"cone","x":25,"y":25},
   {"id":"o2","type":"cone","x":35,"y":25},
   {"id":"o3","type":"cone","x":60,"y":30},
   {"id":"o4","type":"cone","x":70,"y":30},
   {"id":"o5","type":"cone","x":25,"y":55},
   {"id":"o6","type":"cone","x":35,"y":55},
   {"id":"o7","type":"cone","x":60,"y":55},
   {"id":"o8","type":"cone","x":70,"y":55},
   {"id":"o9","type":"cone","x":40,"y":75},
   {"id":"o10","type":"cone","x":50,"y":75},
   {"id":"o11","type":"cone","x":15,"y":15},
   {"id":"o12","type":"cone","x":80,"y":85},
   {"id":"o13","type":"player","x":45,"y":45,"label":"1","color":"#0ea5e9"},
   {"id":"o14","type":"player","x":55,"y":65,"label":"2","color":"#0ea5e9"},
   {"id":"o15","type":"ball","x":47,"y":45},
   {"id":"o16","type":"ball","x":57,"y":65}
 ]'::jsonb,
 '[]'::jsonb),

-- 2. FA Session 2 — Finishing accuracy from side channel
('Side-channel finishing', 'Server plays the ball into a striker who controls and finishes one-touch or two-touch from inside the box. Aim for the corners of the goal.',
 'U9-U13', ARRAY['finishing','shooting','technique'], 12, 4,
 ARRAY['Several balls','1 full goal','4 cones for box'],
 ARRAY['Open hips to the goal on first touch','Strike with laces, low and into the corner','Follow your shot','Server: weight the pass into the path'],
 '[
   {"id":"o1","type":"full-goal","x":50,"y":8},
   {"id":"o2","type":"cone","x":30,"y":25},
   {"id":"o3","type":"cone","x":70,"y":25},
   {"id":"o4","type":"cone","x":30,"y":45},
   {"id":"o5","type":"cone","x":70,"y":45},
   {"id":"o6","type":"player","x":80,"y":55,"label":"S","color":"#0ea5e9"},
   {"id":"o7","type":"player","x":50,"y":40,"label":"F","color":"#0ea5e9"},
   {"id":"o8","type":"ball","x":82,"y":55}
 ]'::jsonb,
 '[
   {"id":"a1","type":"arrow-dashed","geometry":{"from":{"x":80,"y":55},"to":{"x":52,"y":40}}},
   {"id":"a2","type":"arrow-solid","geometry":{"from":{"x":50,"y":35},"to":{"x":42,"y":12}}}
 ]'::jsonb),

-- 3. FA Session 3 — Receiving under pressure (3-zone)
('Receive under pressure', 'Player A passes to player B in the middle zone where a defender pressures. B must take a controlled first touch and play to player C in the far zone.',
 'U10+', ARRAY['receiving','passing','first-touch','pressure'], 12, 5,
 ARRAY['1 ball','6 cones (3 zones)'],
 ARRAY['First touch away from pressure','Open body shape before receiving','Scan over your shoulder before the ball arrives','Decisive second action'],
 '[
   {"id":"o1","type":"cone","x":15,"y":25},
   {"id":"o2","type":"cone","x":85,"y":25},
   {"id":"o3","type":"cone","x":15,"y":50},
   {"id":"o4","type":"cone","x":85,"y":50},
   {"id":"o5","type":"cone","x":15,"y":75},
   {"id":"o6","type":"cone","x":85,"y":75},
   {"id":"o7","type":"player","x":50,"y":85,"label":"A","color":"#0ea5e9"},
   {"id":"o8","type":"player","x":50,"y":50,"label":"B","color":"#0ea5e9"},
   {"id":"o9","type":"player","x":50,"y":15,"label":"C","color":"#0ea5e9"},
   {"id":"o10","type":"player","x":62,"y":50,"label":"X","color":"#ef4444"},
   {"id":"o11","type":"ball","x":52,"y":85}
 ]'::jsonb,
 '[
   {"id":"a1","type":"arrow-dashed","geometry":{"from":{"x":50,"y":82},"to":{"x":50,"y":53}}},
   {"id":"a2","type":"arrow-dashed","geometry":{"from":{"x":50,"y":47},"to":{"x":50,"y":18}}}
 ]'::jsonb),

-- 4. FA Session 4 — 1v1 Defending channel
('1v1 defending channel', 'Attacker dribbles from one end of a 10x20 channel; defender starts level and must delay, jockey and force them wide before winning the ball.',
 'U9+', ARRAY['1v1','defending','technique'], 12, 4,
 ARRAY['Balls','4 cones for channel','1 mini-goal (optional)'],
 ARRAY['Approach quickly, slow on arrival','Side-on stance, low body','Show attacker onto weaker foot','Tackle when balance is lost'],
 '[
   {"id":"o1","type":"mini-goal","x":50,"y":12},
   {"id":"o2","type":"cone","x":35,"y":25},
   {"id":"o3","type":"cone","x":65,"y":25},
   {"id":"o4","type":"cone","x":35,"y":85},
   {"id":"o5","type":"cone","x":65,"y":85},
   {"id":"o6","type":"player","x":50,"y":75,"label":"A","color":"#0ea5e9"},
   {"id":"o7","type":"player","x":50,"y":55,"label":"D","color":"#ef4444"},
   {"id":"o8","type":"ball","x":52,"y":75}
 ]'::jsonb,
 '[
   {"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":72},"to":{"x":50,"y":30}}}
 ]'::jsonb),

-- 5. FA Session 5 — Dribbling with both feet (figure-8)
('Figure-8 dribble', 'Two cones 6m apart. Players dribble around them in a figure-8 pattern, using inside-of-foot one direction and outside-of-foot the other.',
 'U6-U10', ARRAY['dribbling','technique','warm-up'], 8, 6,
 ARRAY['1 ball per player','2 cones per pair'],
 ARRAY['Inside of foot to come around the cone tightly','Outside of foot for speed between cones','Small touches','Both feet equally'],
 '[
   {"id":"o1","type":"cone","x":50,"y":35},
   {"id":"o2","type":"cone","x":50,"y":65},
   {"id":"o3","type":"player","x":50,"y":85,"label":"1"},
   {"id":"o4","type":"ball","x":52,"y":85}
 ]'::jsonb,
 '[
   {"id":"a1","type":"arrow-solid","geometry":{"from":{"x":52,"y":83},"to":{"x":62,"y":65}}},
   {"id":"a2","type":"arrow-solid","geometry":{"from":{"x":62,"y":65},"to":{"x":58,"y":45}}},
   {"id":"a3","type":"arrow-solid","geometry":{"from":{"x":58,"y":45},"to":{"x":42,"y":35}}},
   {"id":"a4","type":"arrow-solid","geometry":{"from":{"x":42,"y":35},"to":{"x":38,"y":55}}},
   {"id":"a5","type":"arrow-solid","geometry":{"from":{"x":38,"y":55},"to":{"x":50,"y":85}}}
 ]'::jsonb),

-- 6. FA Session 6 — Receiving in space (check-away)
('Check-away to receive', 'Receiver makes a sharp movement towards the server then breaks away into space to receive the pass on the half-turn.',
 'U10+', ARRAY['receiving','movement','technique'], 10, 4,
 ARRAY['1 ball per pair','4 cones'],
 ARRAY['Hard, sharp movement to deceive defender','Eye contact / call when ready','First touch away from where you came from','Open body to play forward'],
 '[
   {"id":"o1","type":"cone","x":30,"y":30},
   {"id":"o2","type":"cone","x":70,"y":30},
   {"id":"o3","type":"cone","x":30,"y":70},
   {"id":"o4","type":"cone","x":70,"y":70},
   {"id":"o5","type":"player","x":50,"y":80,"label":"S","color":"#0ea5e9"},
   {"id":"o6","type":"player","x":50,"y":50,"label":"R","color":"#0ea5e9"},
   {"id":"o7","type":"ball","x":52,"y":80}
 ]'::jsonb,
 '[
   {"id":"a1","type":"arrow-dashed","geometry":{"from":{"x":50,"y":50},"to":{"x":50,"y":68}}},
   {"id":"a2","type":"arrow-solid","geometry":{"from":{"x":50,"y":68},"to":{"x":35,"y":40}}},
   {"id":"a3","type":"arrow-dashed","geometry":{"from":{"x":50,"y":78},"to":{"x":36,"y":42}}}
 ]'::jsonb),

-- 7. FA Session 9 — 1v1 Attacking with feint
('1v1 attack with feint', 'Attacker dribbles at the defender and uses a feint or scissor to beat them, then drives to score in the mini-goal.',
 'U9+', ARRAY['1v1','attacking','dribbling'], 12, 4,
 ARRAY['Balls','1 mini-goal','4 cones'],
 ARRAY['Approach at pace then slow down 2m from defender','Sell the feint with body and eyes','Explode past on the other side','Take the shot early'],
 '[
   {"id":"o1","type":"mini-goal","x":50,"y":12},
   {"id":"o2","type":"cone","x":30,"y":30},
   {"id":"o3","type":"cone","x":70,"y":30},
   {"id":"o4","type":"cone","x":30,"y":85},
   {"id":"o5","type":"cone","x":70,"y":85},
   {"id":"o6","type":"player","x":50,"y":75,"label":"A","color":"#0ea5e9"},
   {"id":"o7","type":"player","x":50,"y":45,"label":"D","color":"#ef4444"},
   {"id":"o8","type":"ball","x":52,"y":75}
 ]'::jsonb,
 '[
   {"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":72},"to":{"x":48,"y":55}}},
   {"id":"a2","type":"arrow-solid","geometry":{"from":{"x":48,"y":55},"to":{"x":62,"y":40}}},
   {"id":"a3","type":"arrow-solid","geometry":{"from":{"x":62,"y":40},"to":{"x":52,"y":18}}}
 ]'::jsonb),

-- 8. FA Session 12 — Striking at goal U6-U8 (line shooting)
('Line shooting U6-U8', 'Players line up 8m from a small goal. On their turn, they dribble two touches forward and shoot. Coach feeds the next ball.',
 'U6-U8', ARRAY['shooting','striking','fun'], 10, 8,
 ARRAY['Lots of balls','1 mini-goal','1 starting cone'],
 ARRAY['Two touches then shoot','Plant non-kicking foot beside the ball','Eyes on the ball at contact','Celebrate every shot — confidence first'],
 '[
   {"id":"o1","type":"mini-goal","x":50,"y":12},
   {"id":"o2","type":"cone","x":50,"y":70},
   {"id":"o3","type":"player","x":50,"y":70,"label":"1","color":"#0ea5e9"},
   {"id":"o4","type":"player","x":50,"y":80,"label":"2","color":"#0ea5e9"},
   {"id":"o5","type":"player","x":50,"y":90,"label":"3","color":"#0ea5e9"},
   {"id":"o6","type":"player","x":35,"y":75,"label":"C","color":"#22c55e"},
   {"id":"o7","type":"ball","x":52,"y":70}
 ]'::jsonb,
 '[
   {"id":"a1","type":"arrow-solid","geometry":{"from":{"x":52,"y":68},"to":{"x":50,"y":50}}},
   {"id":"a2","type":"arrow-solid","geometry":{"from":{"x":50,"y":50},"to":{"x":50,"y":15}}}
 ]'::jsonb),

-- 9. FA Session 13 — Striking at goal U9-U12 (driven shot from pass)
('Driven shot from pass U9-U12', 'Server plays a firm pass to the shooter approaching from an angle. Shooter takes one touch out of feet and strikes a driven shot at goal.',
 'U9-U12', ARRAY['shooting','striking','technique'], 12, 4,
 ARRAY['Balls','1 full goal','3 cones'],
 ARRAY['First touch away from your standing foot','Lock the ankle, toes down','Strike through the centre of the ball','Aim low into the corners'],
 '[
   {"id":"o1","type":"full-goal","x":50,"y":8},
   {"id":"o2","type":"cone","x":35,"y":50},
   {"id":"o3","type":"cone","x":65,"y":80},
   {"id":"o4","type":"player","x":65,"y":80,"label":"S","color":"#0ea5e9"},
   {"id":"o5","type":"player","x":35,"y":50,"label":"F","color":"#0ea5e9"},
   {"id":"o6","type":"ball","x":67,"y":80}
 ]'::jsonb,
 '[
   {"id":"a1","type":"arrow-dashed","geometry":{"from":{"x":65,"y":78},"to":{"x":37,"y":52}}},
   {"id":"a2","type":"arrow-solid","geometry":{"from":{"x":40,"y":48},"to":{"x":50,"y":40}}},
   {"id":"a3","type":"arrow-solid","geometry":{"from":{"x":50,"y":40},"to":{"x":58,"y":12}}}
 ]'::jsonb),

-- 10. FA Session 20 — Finishing combination (wall pass and shoot)
('Wall-pass and finish', 'Attacker plays a wall pass with a teammate at the edge of the box, runs onto the return and finishes one-touch.',
 'U11+', ARRAY['finishing','combination','passing'], 15, 4,
 ARRAY['Balls','1 full goal','4 cones for box'],
 ARRAY['Wall player: cushion the return into the path','Attacker: explode after the pass','Decide early — placement vs power','Quality first time finish'],
 '[
   {"id":"o1","type":"full-goal","x":50,"y":8},
   {"id":"o2","type":"cone","x":30,"y":25},
   {"id":"o3","type":"cone","x":70,"y":25},
   {"id":"o4","type":"cone","x":30,"y":50},
   {"id":"o5","type":"cone","x":70,"y":50},
   {"id":"o6","type":"player","x":50,"y":75,"label":"A","color":"#0ea5e9"},
   {"id":"o7","type":"player","x":70,"y":55,"label":"W","color":"#0ea5e9"},
   {"id":"o8","type":"ball","x":52,"y":75}
 ]'::jsonb,
 '[
   {"id":"a1","type":"arrow-dashed","geometry":{"from":{"x":52,"y":74},"to":{"x":68,"y":55}}},
   {"id":"a2","type":"arrow-dashed","geometry":{"from":{"x":68,"y":55},"to":{"x":55,"y":45}}},
   {"id":"a3","type":"arrow-solid","geometry":{"from":{"x":50,"y":72},"to":{"x":55,"y":45}}},
   {"id":"a4","type":"arrow-solid","geometry":{"from":{"x":55,"y":42},"to":{"x":50,"y":13}}}
 ]'::jsonb);

-- Insert drills, skipping any that already exist
INSERT INTO public.drills (
  owner_user_id, name, description, age_group, focus,
  duration_minutes, players_required, equipment, coaching_points,
  visibility, is_official, pitch_size
)
SELECT
  sys_user, s.name, s.description, s.age_group, s.focus,
  s.duration_minutes, s.players_required, s.equipment, s.coaching_points,
  'official', true, 'full'
FROM _new_seed_drills s
WHERE NOT EXISTS (
  SELECT 1 FROM public.drills d WHERE d.name = s.name AND d.is_official = true
);

-- Insert one frame per newly inserted drill
INSERT INTO public.drill_frames (drill_id, position, duration_ms, objects, annotations)
SELECT d.id, 0, 1500, s.objects, s.annotations
FROM public.drills d
JOIN _new_seed_drills s ON s.name = d.name
WHERE d.is_official = true
  AND NOT EXISTS (
    SELECT 1 FROM public.drill_frames f WHERE f.drill_id = d.id
  );

END $$;