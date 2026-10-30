-- Same as previous migration; only the very last annotation literal had a stray ":" instead of "]".
-- Re-running the entire seed in one DO block (idempotent: existing official drills with same name will be skipped via NOT EXISTS guard).

DO $$
DECLARE
  seed_owner uuid := '00000000-0000-0000-0000-000000000000';
  d_id uuid;
BEGIN

-- Helper macro pattern: insert only if (name + is_official) doesn't already exist.

-- 1. Here! There! Nowhere!
IF NOT EXISTS (SELECT 1 FROM public.drills WHERE name='Here! There! Nowhere!' AND is_official=true) THEN
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'Here! There! Nowhere!',
  'Coach calls "Here" (run to coach), "There" (run to far cone), "Nowhere" (freeze). Builds listening, reaction and ball control.',
  'U6-U9', ARRAY['Warm-up','Listening','Dribbling'], 8, 10,
  ARRAY['1 ball per player','4 boundary cones','Bibs'],
  ARRAY['Head up to hear the call','Small touches when changing direction','Stop ball with sole on Nowhere','Look for space, not other players'],
  'Add commands: "Roof" (ball above head), "Floor" (sit on ball).',
  'Walk-only pace; remove ball at first.',
  'club', true, 'small') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 3500, 'Set-up: 20x20 grid, 6 players spread out with a ball each, coach (C) on one side.',
'[{"id":"c1","type":"cone","x":20,"y":20},{"id":"c2","type":"cone","x":80,"y":20},{"id":"c3","type":"cone","x":80,"y":80},{"id":"c4","type":"cone","x":20,"y":80},{"id":"C","type":"player","x":15,"y":50,"label":"C","color":"#f97316"},{"id":"p1","type":"player","x":35,"y":35,"label":"1","color":"#0ea5e9"},{"id":"p2","type":"player","x":55,"y":40,"label":"2","color":"#0ea5e9"},{"id":"p3","type":"player","x":70,"y":55,"label":"3","color":"#0ea5e9"},{"id":"p4","type":"player","x":40,"y":60,"label":"4","color":"#0ea5e9"},{"id":"p5","type":"player","x":60,"y":70,"label":"5","color":"#0ea5e9"},{"id":"p6","type":"player","x":30,"y":50,"label":"6","color":"#0ea5e9"},{"id":"b1","type":"ball","x":36,"y":36},{"id":"b2","type":"ball","x":56,"y":41},{"id":"b3","type":"ball","x":71,"y":56},{"id":"b4","type":"ball","x":41,"y":61},{"id":"b5","type":"ball","x":61,"y":71},{"id":"b6","type":"ball","x":31,"y":51}]'::jsonb,
'[{"id":"z1","type":"zone","geometry":{"x":20,"y":20,"width":60,"height":60},"style":{"color":"#22c55e","opacity":0.12}},{"id":"t1","type":"text","geometry":{"x":50,"y":15,"text":"Players spread, dribbling"}}]'::jsonb),
(d_id, 1, 3500, 'Coach calls "HERE!" — all players dribble toward coach.',
'[{"id":"C","type":"player","x":15,"y":50,"label":"C","color":"#f97316"},{"id":"p1","type":"player","x":28,"y":45,"label":"1","color":"#0ea5e9"},{"id":"p2","type":"player","x":32,"y":48,"label":"2","color":"#0ea5e9"},{"id":"p3","type":"player","x":40,"y":52,"label":"3","color":"#0ea5e9"},{"id":"p4","type":"player","x":35,"y":58,"label":"4","color":"#0ea5e9"},{"id":"p5","type":"player","x":42,"y":62,"label":"5","color":"#0ea5e9"},{"id":"p6","type":"player","x":26,"y":52,"label":"6","color":"#0ea5e9"}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":55,"y":40},"to":{"x":25,"y":50}},"style":{"color":"#fbbf24"}},{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"HERE! → all dribble to coach"}}]'::jsonb),
(d_id, 2, 3500, 'Coach calls "THERE!" — all dribble to far cone.',
'[{"id":"C","type":"player","x":15,"y":50,"label":"C","color":"#f97316"},{"id":"c2","type":"cone","x":80,"y":20},{"id":"p1","type":"player","x":70,"y":30,"label":"1","color":"#0ea5e9"},{"id":"p2","type":"player","x":75,"y":35,"label":"2","color":"#0ea5e9"},{"id":"p3","type":"player","x":78,"y":42,"label":"3","color":"#0ea5e9"},{"id":"p4","type":"player","x":72,"y":45,"label":"4","color":"#0ea5e9"},{"id":"p5","type":"player","x":74,"y":52,"label":"5","color":"#0ea5e9"},{"id":"p6","type":"player","x":68,"y":48,"label":"6","color":"#0ea5e9"}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":35,"y":50},"to":{"x":75,"y":40}},"style":{"color":"#fbbf24"}},{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"THERE! → all sprint dribble to cone"}}]'::jsonb),
(d_id, 3, 3500, 'Coach calls "NOWHERE!" — players freeze with foot on ball.',
'[{"id":"C","type":"player","x":15,"y":50,"label":"C","color":"#f97316"},{"id":"p1","type":"player","x":40,"y":35,"label":"1","color":"#0ea5e9"},{"id":"p2","type":"player","x":58,"y":40,"label":"2","color":"#0ea5e9"},{"id":"p3","type":"player","x":68,"y":52,"label":"3","color":"#0ea5e9"},{"id":"p4","type":"player","x":50,"y":58,"label":"4","color":"#0ea5e9"},{"id":"p5","type":"player","x":62,"y":68,"label":"5","color":"#0ea5e9"},{"id":"p6","type":"player","x":35,"y":62,"label":"6","color":"#0ea5e9"}]'::jsonb,
'[{"id":"sm1","type":"step-marker","geometry":{"x":50,"y":50,"number":3}},{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"NOWHERE! → freeze, sole on ball"}}]'::jsonb);
END IF;

-- 17. Combination to goal (ONLY this one — last frame had typo; rest were valid in previous attempt but the whole DO block aborted)
-- The previous migration FAILED ENTIRELY due to the typo on the last frame of drill 17.
-- We need to re-run all 17 drills. To keep this manageable, re-run the previous SQL but with the typo fixed.
-- Since the previous migration aborted before any inserts committed (single DO block), we re-insert everything below.

-- 2. Fox and Geese Tag
IF NOT EXISTS (SELECT 1 FROM public.drills WHERE name='Fox and Geese Tag' AND is_official=true) THEN
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'Fox and Geese Tag',
  'Two foxes (taggers) chase the geese (dribblers). Tagged geese become foxes — last goose wins.',
  'U6-U10', ARRAY['Warm-up','Dribbling','Shielding'], 8, 8,
  ARRAY['1 ball per goose','Bibs for foxes','4 boundary cones'],
  ARRAY['Keep ball close when being chased','Scan for safe space','Use body to shield','Burst pace to escape'],
  'Increase number of foxes; reduce grid size.',
  'Foxes walk only; geese have a 3s safe zone.',
  'club', true, 'small') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 4000, 'Set-up: 25x25 grid. 2 foxes (red), 6 geese (blue) with ball. W sub in for tagged geese.',
'[{"id":"c1","type":"cone","x":18,"y":18},{"id":"c2","type":"cone","x":82,"y":18},{"id":"c3","type":"cone","x":82,"y":82},{"id":"c4","type":"cone","x":18,"y":82},{"id":"F1","type":"player","x":40,"y":40,"label":"F1","color":"#ef4444"},{"id":"F2","type":"player","x":60,"y":60,"label":"F2","color":"#ef4444"},{"id":"g1","type":"player","x":30,"y":30,"label":"1","color":"#0ea5e9"},{"id":"g2","type":"player","x":70,"y":30,"label":"2","color":"#0ea5e9"},{"id":"g3","type":"player","x":70,"y":70,"label":"3","color":"#0ea5e9"},{"id":"g4","type":"player","x":30,"y":70,"label":"4","color":"#0ea5e9"},{"id":"g5","type":"player","x":50,"y":30,"label":"5","color":"#0ea5e9"},{"id":"g6","type":"player","x":50,"y":70,"label":"6","color":"#0ea5e9"},{"id":"W1","type":"player","x":10,"y":10,"label":"W1","color":"#94a3b8"},{"id":"W2","type":"player","x":10,"y":18,"label":"W2","color":"#94a3b8"}]'::jsonb,
'[{"id":"z1","type":"zone","geometry":{"x":18,"y":18,"width":64,"height":64},"style":{"color":"#22c55e","opacity":0.1}},{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Foxes (red) chase geese (blue)"}}]'::jsonb),
(d_id, 1, 4000, 'F1 closes on goose 5 — goose shields, others scan.',
'[{"id":"F1","type":"player","x":48,"y":35,"label":"F1","color":"#ef4444"},{"id":"F2","type":"player","x":55,"y":62,"label":"F2","color":"#ef4444"},{"id":"g5","type":"player","x":58,"y":28,"label":"5","color":"#0ea5e9"},{"id":"g1","type":"player","x":25,"y":35,"label":"1","color":"#0ea5e9"},{"id":"g2","type":"player","x":78,"y":40,"label":"2","color":"#0ea5e9"},{"id":"W1","type":"player","x":10,"y":10,"label":"W1","color":"#94a3b8"}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":40,"y":40},"to":{"x":48,"y":35}},"style":{"color":"#ef4444"}},{"id":"a2","type":"arrow-dashed","geometry":{"from":{"x":50,"y":30},"to":{"x":58,"y":28}},"style":{"color":"#a78bfa"}}]'::jsonb),
(d_id, 2, 4000, 'Goose 5 tagged — becomes fox. W1 enters as new goose.',
'[{"id":"F1","type":"player","x":54,"y":30,"label":"F1","color":"#ef4444"},{"id":"F2","type":"player","x":50,"y":55,"label":"F2","color":"#ef4444"},{"id":"F3","type":"player","x":58,"y":28,"label":"F3","color":"#ef4444"},{"id":"W1","type":"player","x":35,"y":50,"label":"W1","color":"#0ea5e9"},{"id":"g1","type":"player","x":22,"y":40,"label":"1","color":"#0ea5e9"}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":10,"y":10},"to":{"x":35,"y":50}},"style":{"color":"#22c55e"}},{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Tagged → fox; W1 subs in"}}]'::jsonb),
(d_id, 3, 4000, 'Three foxes hunting — geese must work harder.',
'[{"id":"F1","type":"player","x":35,"y":40,"label":"F1","color":"#ef4444"},{"id":"F2","type":"player","x":60,"y":55,"label":"F2","color":"#ef4444"},{"id":"F3","type":"player","x":68,"y":35,"label":"F3","color":"#ef4444"},{"id":"W1","type":"player","x":30,"y":30,"label":"W1","color":"#0ea5e9"},{"id":"g1","type":"player","x":25,"y":60,"label":"1","color":"#0ea5e9"}]'::jsonb,
'[{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Foxes multiply — last goose wins"}}]'::jsonb);
END IF;

-- 3. Circle Chase
IF NOT EXISTS (SELECT 1 FROM public.drills WHERE name='Circle Chase' AND is_official=true) THEN
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'Circle Chase',
  'Players in a circle dribble around trying to catch the player in front. Builds dribbling at speed.',
  'U6-U10', ARRAY['Warm-up','Dribbling','Speed'], 8, 8,
  ARRAY['1 ball per player','8 marker cones to form circle'],
  ARRAY['Push ball into space ahead','Use laces to dribble fast','Close control on turns','Look up to track player ahead'],
  'Reverse direction on whistle.',
  'Walking pace; larger circle.',
  'club', true, 'small') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 3500, 'Set-up: 8 cones form circle, player at each cone with ball.',
'[{"id":"c1","type":"cone","x":50,"y":15},{"id":"c2","type":"cone","x":75,"y":25},{"id":"c3","type":"cone","x":85,"y":50},{"id":"c4","type":"cone","x":75,"y":75},{"id":"c5","type":"cone","x":50,"y":85},{"id":"c6","type":"cone","x":25,"y":75},{"id":"c7","type":"cone","x":15,"y":50},{"id":"c8","type":"cone","x":25,"y":25},{"id":"p1","type":"player","x":50,"y":18,"label":"1","color":"#0ea5e9"},{"id":"p2","type":"player","x":74,"y":28,"label":"2","color":"#0ea5e9"},{"id":"p3","type":"player","x":83,"y":50,"label":"3","color":"#0ea5e9"},{"id":"p4","type":"player","x":74,"y":72,"label":"4","color":"#0ea5e9"},{"id":"p5","type":"player","x":50,"y":82,"label":"5","color":"#0ea5e9"},{"id":"p6","type":"player","x":26,"y":72,"label":"6","color":"#0ea5e9"},{"id":"p7","type":"player","x":17,"y":50,"label":"7","color":"#0ea5e9"},{"id":"p8","type":"player","x":26,"y":28,"label":"8","color":"#0ea5e9"}]'::jsonb,
'[{"id":"t1","type":"text","geometry":{"x":50,"y":50,"text":"Players ready"}}]'::jsonb),
(d_id, 1, 3500, 'GO! Dribble clockwise.',
'[{"id":"p1","type":"player","x":62,"y":20,"label":"1","color":"#0ea5e9"},{"id":"p2","type":"player","x":80,"y":37,"label":"2","color":"#0ea5e9"},{"id":"p3","type":"player","x":80,"y":62,"label":"3","color":"#0ea5e9"},{"id":"p4","type":"player","x":62,"y":80,"label":"4","color":"#0ea5e9"},{"id":"p5","type":"player","x":38,"y":80,"label":"5","color":"#0ea5e9"},{"id":"p6","type":"player","x":20,"y":62,"label":"6","color":"#0ea5e9"},{"id":"p7","type":"player","x":20,"y":37,"label":"7","color":"#0ea5e9"},{"id":"p8","type":"player","x":38,"y":20,"label":"8","color":"#0ea5e9"}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":18},"to":{"x":62,"y":20}},"style":{"color":"#fbbf24"}},{"id":"t1","type":"text","geometry":{"x":50,"y":50,"text":"Dribble clockwise"}}]'::jsonb),
(d_id, 2, 3500, 'REVERSE!',
'[{"id":"p1","type":"player","x":38,"y":20,"label":"1","color":"#0ea5e9"},{"id":"p2","type":"player","x":62,"y":20,"label":"2","color":"#0ea5e9"},{"id":"p3","type":"player","x":80,"y":37,"label":"3","color":"#0ea5e9"},{"id":"p4","type":"player","x":80,"y":62,"label":"4","color":"#0ea5e9"},{"id":"p5","type":"player","x":62,"y":80,"label":"5","color":"#0ea5e9"},{"id":"p6","type":"player","x":38,"y":80,"label":"6","color":"#0ea5e9"},{"id":"p7","type":"player","x":20,"y":62,"label":"7","color":"#0ea5e9"},{"id":"p8","type":"player","x":20,"y":37,"label":"8","color":"#0ea5e9"}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":62,"y":20},"to":{"x":38,"y":20}},"style":{"color":"#a78bfa"}},{"id":"t1","type":"text","geometry":{"x":50,"y":50,"text":"REVERSE!"}}]'::jsonb);
END IF;

-- 4. Foot-volleyball
IF NOT EXISTS (SELECT 1 FROM public.drills WHERE name='Foot-volleyball' AND is_official=true) THEN
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'Foot-volleyball',
  'Two teams play volleyball-style with feet/head over a low rope. Three touches per side.',
  'U10-U14', ARRAY['First touch','Technique','Teamwork'], 12, 8,
  ARRAY['1 ball','Rope or low net','4 cones'],
  ARRAY['Cushion ball with first touch','Position body under ball','Communicate','Vary surface — thigh, chest, foot'],
  'Two-touch only; smaller court.',
  'Allow ball to bounce twice between touches.',
  'club', true, 'small') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 4000, 'Set-up: court split by rope at y=50. A bottom, B top, 3 each. W sub in.',
'[{"id":"A1","type":"player","x":35,"y":65,"label":"A1","color":"#0ea5e9"},{"id":"A2","type":"player","x":50,"y":70,"label":"A2","color":"#0ea5e9"},{"id":"A3","type":"player","x":65,"y":65,"label":"A3","color":"#0ea5e9"},{"id":"B1","type":"player","x":35,"y":35,"label":"B1","color":"#ef4444"},{"id":"B2","type":"player","x":50,"y":30,"label":"B2","color":"#ef4444"},{"id":"B3","type":"player","x":65,"y":35,"label":"B3","color":"#ef4444"},{"id":"W1","type":"player","x":12,"y":75,"label":"W1","color":"#94a3b8"},{"id":"W2","type":"player","x":12,"y":25,"label":"W2","color":"#94a3b8"},{"id":"b1","type":"ball","x":50,"y":68}]'::jsonb,
'[{"id":"z1","type":"zone","geometry":{"x":25,"y":48,"width":50,"height":4},"style":{"color":"#fbbf24","opacity":0.6}},{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Team A serves"}}]'::jsonb),
(d_id, 1, 4000, 'A2 cushions ball up — 1st touch.',
'[{"id":"A2","type":"player","x":50,"y":68,"label":"A2","color":"#0ea5e9"},{"id":"b1","type":"ball","x":50,"y":60}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":68},"to":{"x":50,"y":60}},"style":{"color":"#fbbf24"}},{"id":"sm1","type":"step-marker","geometry":{"x":55,"y":62,"number":1}}]'::jsonb),
(d_id, 2, 4000, 'A3 sets to A1 — 2nd touch.',
'[{"id":"A1","type":"player","x":40,"y":60,"label":"A1","color":"#0ea5e9"},{"id":"A3","type":"player","x":60,"y":60,"label":"A3","color":"#0ea5e9"},{"id":"b1","type":"ball","x":45,"y":58}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":60,"y":60},"to":{"x":42,"y":58}},"style":{"color":"#fbbf24"}},{"id":"sm1","type":"step-marker","geometry":{"x":50,"y":52,"number":2}}]'::jsonb),
(d_id, 3, 4000, 'A1 lifts over rope — 3rd touch.',
'[{"id":"A1","type":"player","x":40,"y":58,"label":"A1","color":"#0ea5e9"},{"id":"b1","type":"ball","x":55,"y":40}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":42,"y":58},"to":{"x":55,"y":40}},"style":{"color":"#fbbf24","width":3}},{"id":"sm1","type":"step-marker","geometry":{"x":50,"y":48,"number":3}}]'::jsonb),
(d_id, 4, 4000, 'Point won — W1 rotates onto Team A; A1 becomes W.',
'[{"id":"W1","type":"player","x":35,"y":65,"label":"W1","color":"#0ea5e9"},{"id":"A1","type":"player","x":12,"y":75,"label":"A1","color":"#94a3b8"}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":12,"y":75},"to":{"x":35,"y":65}},"style":{"color":"#22c55e"}},{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Rotation: W1 in, A1 out"}}]'::jsonb);
END IF;

-- 5. Empty the Nest
IF NOT EXISTS (SELECT 1 FROM public.drills WHERE name='Empty the Nest' AND is_official=true) THEN
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'Empty the Nest',
  'Two teams race to pass/dribble balls out of the central nest into their own goal area.',
  'U7-U10', ARRAY['Passing','Decision-making','Speed'], 10, 8,
  ARRAY['8-10 balls','4 mini-goals','8 cones'],
  ARRAY['Quick scan before deciding','Pass weight to team-mate','Communicate yes/man on','Choose pass vs dribble'],
  'Defenders allowed to intercept.',
  'No defenders; larger goals.',
  'club', true, 'small') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 4000, 'Set-up: 8 balls in central nest, mini-goals at each end. 4 per team plus 2 W.',
'[{"id":"gA","type":"mini-goal","x":50,"y":12},{"id":"gB","type":"mini-goal","x":50,"y":88},{"id":"A1","type":"player","x":30,"y":35,"label":"A1","color":"#0ea5e9"},{"id":"A2","type":"player","x":70,"y":35,"label":"A2","color":"#0ea5e9"},{"id":"A3","type":"player","x":50,"y":25,"label":"A3","color":"#0ea5e9"},{"id":"A4","type":"player","x":50,"y":18,"label":"A4","color":"#0ea5e9"},{"id":"B1","type":"player","x":30,"y":65,"label":"B1","color":"#ef4444"},{"id":"B2","type":"player","x":70,"y":65,"label":"B2","color":"#ef4444"},{"id":"B3","type":"player","x":50,"y":75,"label":"B3","color":"#ef4444"},{"id":"B4","type":"player","x":50,"y":82,"label":"B4","color":"#ef4444"},{"id":"W1","type":"player","x":10,"y":35,"label":"W1","color":"#94a3b8"},{"id":"W2","type":"player","x":10,"y":65,"label":"W2","color":"#94a3b8"},{"id":"b1","type":"ball","x":45,"y":48},{"id":"b2","type":"ball","x":50,"y":48},{"id":"b3","type":"ball","x":55,"y":48},{"id":"b4","type":"ball","x":48,"y":52},{"id":"b5","type":"ball","x":52,"y":52}]'::jsonb,
'[{"id":"z1","type":"zone","geometry":{"x":40,"y":48,"width":20,"height":4},"style":{"color":"#fbbf24","opacity":0.3}},{"id":"t1","type":"text","geometry":{"x":50,"y":42,"text":"NEST"}}]'::jsonb),
(d_id, 1, 4000, 'GO! A3 grabs ball, passes wide to A1. B3 dribbles toward Team B goal.',
'[{"id":"A1","type":"player","x":28,"y":30,"label":"A1","color":"#0ea5e9"},{"id":"A3","type":"player","x":50,"y":42,"label":"A3","color":"#0ea5e9"},{"id":"B3","type":"player","x":50,"y":58,"label":"B3","color":"#ef4444"},{"id":"b1","type":"ball","x":35,"y":36},{"id":"b2","type":"ball","x":50,"y":58}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":48},"to":{"x":30,"y":32}},"style":{"color":"#fbbf24"}}]'::jsonb),
(d_id, 2, 4000, 'A1 finishes; B4 finishes.',
'[{"id":"A1","type":"player","x":35,"y":20,"label":"A1","color":"#0ea5e9"},{"id":"B4","type":"player","x":55,"y":80,"label":"B4","color":"#ef4444"},{"id":"b1","type":"ball","x":50,"y":14},{"id":"b2","type":"ball","x":50,"y":86}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":35,"y":20},"to":{"x":50,"y":14}},"style":{"color":"#fbbf24","width":3}}]'::jsonb),
(d_id, 3, 4000, 'Round ends — W1 → A team, A4 → W. Reset balls in nest.',
'[{"id":"W1","type":"player","x":50,"y":18,"label":"W1","color":"#0ea5e9"},{"id":"A4","type":"player","x":10,"y":35,"label":"A4","color":"#94a3b8"}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":18},"to":{"x":10,"y":35}},"style":{"color":"#94a3b8"}},{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Rotation: W in, A4/B4 out"}}]'::jsonb);
END IF;

-- 6. Beat my Record!
IF NOT EXISTS (SELECT 1 FROM public.drills WHERE name='Beat my Record!' AND is_official=true) THEN
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'Beat my Record!',
  'Pairs count consecutive passes through gates in 60 seconds, then try to beat their score.',
  'U8-U12', ARRAY['Passing','First touch','Repetition'], 10, 8,
  ARRAY['1 ball per pair','2 cones per pair (gate)','Stopwatch'],
  ARRAY['Side-foot, ankle locked','Pass through middle of gate','Receive across body','Call count out loud'],
  'Reduce gate width; one-touch only.',
  'Wider gate; allow two touches.',
  'club', true, 'small') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 4000, 'Set-up: 4 pairs, gates 2m apart, 8m between players. 2 W on side rotate every 60s.',
'[{"id":"g1a","type":"cone","x":48,"y":25},{"id":"g1b","type":"cone","x":52,"y":25},{"id":"g2a","type":"cone","x":48,"y":45},{"id":"g2b","type":"cone","x":52,"y":45},{"id":"g3a","type":"cone","x":48,"y":65},{"id":"g3b","type":"cone","x":52,"y":65},{"id":"g4a","type":"cone","x":48,"y":85},{"id":"g4b","type":"cone","x":52,"y":85},{"id":"P1A","type":"player","x":35,"y":25,"label":"1A","color":"#0ea5e9"},{"id":"P1B","type":"player","x":65,"y":25,"label":"1B","color":"#0ea5e9"},{"id":"P2A","type":"player","x":35,"y":45,"label":"2A","color":"#0ea5e9"},{"id":"P2B","type":"player","x":65,"y":45,"label":"2B","color":"#0ea5e9"},{"id":"P3A","type":"player","x":35,"y":65,"label":"3A","color":"#0ea5e9"},{"id":"P3B","type":"player","x":65,"y":65,"label":"3B","color":"#0ea5e9"},{"id":"P4A","type":"player","x":35,"y":85,"label":"4A","color":"#0ea5e9"},{"id":"P4B","type":"player","x":65,"y":85,"label":"4B","color":"#0ea5e9"},{"id":"W1","type":"player","x":12,"y":40,"label":"W1","color":"#94a3b8"},{"id":"W2","type":"player","x":12,"y":60,"label":"W2","color":"#94a3b8"},{"id":"b1","type":"ball","x":37,"y":25},{"id":"b2","type":"ball","x":37,"y":45},{"id":"b3","type":"ball","x":37,"y":65},{"id":"b4","type":"ball","x":37,"y":85}]'::jsonb,
'[{"id":"t1","type":"text","geometry":{"x":50,"y":15,"text":"Beat your record — 60s passes through gate"}}]'::jsonb),
(d_id, 1, 4000, 'Pass through gate to partner — count 1.',
'[{"id":"b1","type":"ball","x":50,"y":25},{"id":"b2","type":"ball","x":50,"y":45},{"id":"b3","type":"ball","x":50,"y":65},{"id":"b4","type":"ball","x":50,"y":85}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":37,"y":25},"to":{"x":63,"y":25}},"style":{"color":"#fbbf24"}},{"id":"a2","type":"arrow-solid","geometry":{"from":{"x":37,"y":45},"to":{"x":63,"y":45}},"style":{"color":"#fbbf24"}}]'::jsonb),
(d_id, 2, 4000, 'Partner returns first time — count 2.',
'[]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":63,"y":25},"to":{"x":37,"y":25}},"style":{"color":"#a78bfa"}}]'::jsonb),
(d_id, 3, 4000, 'Round done — W1/W2 swap in, 1A/1B step out.',
'[{"id":"W1","type":"player","x":35,"y":25,"label":"W1","color":"#0ea5e9"},{"id":"W2","type":"player","x":65,"y":25,"label":"W2","color":"#0ea5e9"},{"id":"P1A","type":"player","x":12,"y":40,"label":"1A","color":"#94a3b8"},{"id":"P1B","type":"player","x":12,"y":60,"label":"1B","color":"#94a3b8"}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":12,"y":40},"to":{"x":35,"y":25}},"style":{"color":"#22c55e"}},{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Rotation between rounds"}}]'::jsonb);
END IF;

-- 7. The Battle (1v1 channels)
IF NOT EXISTS (SELECT 1 FROM public.drills WHERE name='The Battle (1v1 channels)' AND is_official=true) THEN
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'The Battle (1v1 channels)',
  'Attacker beats defender to score in mini-goal. Loser becomes defender; winner stays.',
  'U8-U13', ARRAY['1v1 attacking','Defending','Conditioning'], 12, 8,
  ARRAY['8 cones','2 mini-goals','Balls','Bibs'],
  ARRAY['Attack at speed','Disguise direction with body','Defender side-on, low','Force attacker onto weaker foot'],
  'Add second defender; goalkeeper added.',
  'Wider channel; defender passive.',
  'club', true, 'small') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 4000, 'Set-up: 6m wide channel; mini-goal at top. A starts with ball, D faces. W1-W4 wait.',
'[{"id":"g","type":"mini-goal","x":50,"y":12},{"id":"c1","type":"cone","x":35,"y":15},{"id":"c2","type":"cone","x":65,"y":15},{"id":"c3","type":"cone","x":35,"y":75},{"id":"c4","type":"cone","x":65,"y":75},{"id":"A","type":"player","x":50,"y":68,"label":"A","color":"#0ea5e9"},{"id":"D","type":"player","x":50,"y":40,"label":"D","color":"#ef4444"},{"id":"W1","type":"player","x":18,"y":80,"label":"W1","color":"#94a3b8"},{"id":"W2","type":"player","x":18,"y":85,"label":"W2","color":"#94a3b8"},{"id":"W3","type":"player","x":18,"y":90,"label":"W3","color":"#94a3b8"},{"id":"W4","type":"player","x":18,"y":95,"label":"W4","color":"#94a3b8"},{"id":"b1","type":"ball","x":52,"y":68}]'::jsonb,
'[{"id":"z1","type":"zone","geometry":{"x":35,"y":15,"width":30,"height":60},"style":{"color":"#22c55e","opacity":0.1}}]'::jsonb),
(d_id, 1, 4000, 'A drives at D, feints right.',
'[{"id":"A","type":"player","x":55,"y":50,"label":"A","color":"#0ea5e9"},{"id":"D","type":"player","x":53,"y":38,"label":"D","color":"#ef4444"},{"id":"b1","type":"ball","x":57,"y":51}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":68},"to":{"x":55,"y":50}},"style":{"color":"#fbbf24"}}]'::jsonb),
(d_id, 2, 4000, 'A cuts left, beats D, finishes.',
'[{"id":"A","type":"player","x":42,"y":25,"label":"A","color":"#0ea5e9"},{"id":"b1","type":"ball","x":48,"y":18}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":42,"y":25},"to":{"x":50,"y":13}},"style":{"color":"#fbbf24","width":3}}]'::jsonb),
(d_id, 3, 4000, 'A wins → stays. D leaves to back of queue. W1 enters as new defender.',
'[{"id":"A","type":"player","x":50,"y":68,"label":"A","color":"#0ea5e9"},{"id":"W1","type":"player","x":50,"y":40,"label":"W1","color":"#ef4444"},{"id":"D","type":"player","x":18,"y":80,"label":"D","color":"#94a3b8"}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":18,"y":80},"to":{"x":50,"y":40}},"style":{"color":"#22c55e"}},{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Winner stays — W1 defends next"}}]'::jsonb);
END IF;

-- 8. Boundary Pass
IF NOT EXISTS (SELECT 1 FROM public.drills WHERE name='Boundary Pass' AND is_official=true) THEN
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'Boundary Pass',
  'Outside players pass 1-touch with player inside. Inside player rotates after 8 passes.',
  'U10-U14', ARRAY['Passing','First touch','Movement'], 10, 9,
  ARRAY['1 ball','4 cones for grid'],
  ARRAY['Open body to receive','Pass with weight','Move after passing','Eyes up before receiving'],
  'Two-touch only; add second ball.',
  'Allow three touches.',
  'club', true, 'medium') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 4000, 'Set-up: P1 inside; 6 outside players plus 2 W.',
'[{"id":"c1","type":"cone","x":25,"y":25},{"id":"c2","type":"cone","x":75,"y":25},{"id":"c3","type":"cone","x":75,"y":75},{"id":"c4","type":"cone","x":25,"y":75},{"id":"P1","type":"player","x":50,"y":50,"label":"P1","color":"#f97316"},{"id":"P2","type":"player","x":50,"y":22,"label":"P2","color":"#0ea5e9"},{"id":"P3","type":"player","x":78,"y":35,"label":"P3","color":"#0ea5e9"},{"id":"P4","type":"player","x":78,"y":65,"label":"P4","color":"#0ea5e9"},{"id":"P5","type":"player","x":50,"y":78,"label":"P5","color":"#0ea5e9"},{"id":"P6","type":"player","x":22,"y":65,"label":"P6","color":"#0ea5e9"},{"id":"P7","type":"player","x":22,"y":35,"label":"P7","color":"#0ea5e9"},{"id":"W1","type":"player","x":10,"y":15,"label":"W1","color":"#94a3b8"},{"id":"W2","type":"player","x":10,"y":85,"label":"W2","color":"#94a3b8"},{"id":"b1","type":"ball","x":52,"y":24}]'::jsonb,
'[{"id":"z1","type":"zone","geometry":{"x":25,"y":25,"width":50,"height":50},"style":{"color":"#22c55e","opacity":0.1}}]'::jsonb),
(d_id, 1, 4000, 'P2 plays into P1. P1 lays back.',
'[{"id":"b1","type":"ball","x":55,"y":28}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":22},"to":{"x":50,"y":48}},"style":{"color":"#fbbf24"}},{"id":"a2","type":"arrow-solid","geometry":{"from":{"x":50,"y":52},"to":{"x":62,"y":24}},"style":{"color":"#a78bfa"}}]'::jsonb),
(d_id, 2, 4000, 'P3 receives next.',
'[{"id":"b1","type":"ball","x":75,"y":50}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":50},"to":{"x":75,"y":50}},"style":{"color":"#fbbf24"}}]'::jsonb),
(d_id, 3, 4000, 'After 8 passes — P1 swaps with W1; P5 with W2.',
'[{"id":"W1","type":"player","x":50,"y":50,"label":"W1","color":"#f97316"},{"id":"P1","type":"player","x":10,"y":15,"label":"P1","color":"#94a3b8"},{"id":"W2","type":"player","x":50,"y":78,"label":"W2","color":"#0ea5e9"},{"id":"P5","type":"player","x":10,"y":85,"label":"P5","color":"#94a3b8"}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":10,"y":15},"to":{"x":50,"y":50}},"style":{"color":"#22c55e"}},{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Inside swap every 8 passes"}}]'::jsonb);
END IF;

-- 9. Shuttle Pass
IF NOT EXISTS (SELECT 1 FROM public.drills WHERE name='Shuttle Pass' AND is_official=true) THEN
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'Shuttle Pass',
  'Two facing lines — pass and follow to back of opposite line. Continuous flow, no waiting players.',
  'U7-U12', ARRAY['Passing','Movement','Repetition'], 10, 8,
  ARRAY['1 ball per group','4 cones'],
  ARRAY['Inside of foot','Run after passing','First touch out of feet','Quality over speed'],
  'Two-touch limit; second ball.',
  'Stop-and-pass; shorter distance.',
  'club', true, 'small') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 3500, 'Set-up: two lines of 4 facing each other 8m apart.',
'[{"id":"cL","type":"cone","x":30,"y":50},{"id":"cR","type":"cone","x":70,"y":50},{"id":"L1","type":"player","x":30,"y":50,"label":"L1","color":"#0ea5e9"},{"id":"L2","type":"player","x":24,"y":56,"label":"L2","color":"#0ea5e9"},{"id":"L3","type":"player","x":18,"y":62,"label":"L3","color":"#0ea5e9"},{"id":"L4","type":"player","x":12,"y":68,"label":"L4","color":"#0ea5e9"},{"id":"R1","type":"player","x":70,"y":50,"label":"R1","color":"#0ea5e9"},{"id":"R2","type":"player","x":76,"y":56,"label":"R2","color":"#0ea5e9"},{"id":"R3","type":"player","x":82,"y":62,"label":"R3","color":"#0ea5e9"},{"id":"R4","type":"player","x":88,"y":68,"label":"R4","color":"#0ea5e9"},{"id":"b1","type":"ball","x":32,"y":50}]'::jsonb,
'[{"id":"t1","type":"text","geometry":{"x":50,"y":40,"text":"Pass and follow"}}]'::jsonb),
(d_id, 1, 3500, 'L1 passes to R1 then jogs to back of R line.',
'[{"id":"L1","type":"player","x":50,"y":50,"label":"L1","color":"#0ea5e9"},{"id":"b1","type":"ball","x":55,"y":50}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":32,"y":50},"to":{"x":68,"y":50}},"style":{"color":"#fbbf24"}},{"id":"a2","type":"arrow-dashed","geometry":{"from":{"x":32,"y":50},"to":{"x":88,"y":72}},"style":{"color":"#a78bfa"}}]'::jsonb),
(d_id, 2, 3500, 'R1 plays to L2, jogs to back of L line.',
'[{"id":"R1","type":"player","x":50,"y":50,"label":"R1","color":"#0ea5e9"},{"id":"L1","type":"player","x":88,"y":72,"label":"L1","color":"#0ea5e9"},{"id":"b1","type":"ball","x":45,"y":50}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":68,"y":50},"to":{"x":32,"y":50}},"style":{"color":"#fbbf24"}}]'::jsonb);
END IF;

-- 10. Keep the Ball (4v2)
IF NOT EXISTS (SELECT 1 FROM public.drills WHERE name='Keep the Ball (4v2)' AND is_official=true) THEN
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'Keep the Ball (4v2)',
  '4v2 possession box. Defenders rotate when they win the ball; W sub in every 90s.',
  'U10-U14', ARRAY['Possession','Pressing','Decision-making'], 12, 8,
  ARRAY['1 ball','4 cones','Bibs'],
  ARRAY['Angle of pass','Triangle shape','Defender screens nearest pass','Speed of play under pressure'],
  '3v2 or add target player.',
  '5v2; bigger box.',
  'club', true, 'medium') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 4000, 'Set-up: 12x12 grid. 4 attackers outside corners, 2 defenders inside. 2 W on side.',
'[{"id":"c1","type":"cone","x":25,"y":25},{"id":"c2","type":"cone","x":75,"y":25},{"id":"c3","type":"cone","x":75,"y":75},{"id":"c4","type":"cone","x":25,"y":75},{"id":"A1","type":"player","x":28,"y":28,"label":"A1","color":"#0ea5e9"},{"id":"A2","type":"player","x":72,"y":28,"label":"A2","color":"#0ea5e9"},{"id":"A3","type":"player","x":72,"y":72,"label":"A3","color":"#0ea5e9"},{"id":"A4","type":"player","x":28,"y":72,"label":"A4","color":"#0ea5e9"},{"id":"D1","type":"player","x":42,"y":50,"label":"D1","color":"#ef4444"},{"id":"D2","type":"player","x":58,"y":50,"label":"D2","color":"#ef4444"},{"id":"W1","type":"player","x":12,"y":40,"label":"W1","color":"#94a3b8"},{"id":"W2","type":"player","x":12,"y":60,"label":"W2","color":"#94a3b8"},{"id":"b1","type":"ball","x":30,"y":28}]'::jsonb,
'[{"id":"z1","type":"zone","geometry":{"x":25,"y":25,"width":50,"height":50},"style":{"color":"#22c55e","opacity":0.1}}]'::jsonb),
(d_id, 1, 4000, 'A1→A2; D1 closes; A2→A3.',
'[{"id":"D1","type":"player","x":58,"y":35,"label":"D1","color":"#ef4444"},{"id":"b1","type":"ball","x":72,"y":50}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":28,"y":28},"to":{"x":72,"y":28}},"style":{"color":"#fbbf24"}},{"id":"a2","type":"arrow-solid","geometry":{"from":{"x":72,"y":28},"to":{"x":72,"y":72}},"style":{"color":"#fbbf24"}}]'::jsonb),
(d_id, 2, 4000, 'D2 wins ball — D2 swaps with A4.',
'[{"id":"D2","type":"player","x":28,"y":72,"label":"D2","color":"#0ea5e9"},{"id":"A4","type":"player","x":50,"y":55,"label":"A4","color":"#ef4444"},{"id":"b1","type":"ball","x":52,"y":55}]'::jsonb,
'[{"id":"sm1","type":"step-marker","geometry":{"x":40,"y":62,"number":1}},{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Turnover — A4 → defender"}}]'::jsonb),
(d_id, 3, 4000, '90s up — W1/W2 in for D1/A1; they become W. Reset.',
'[{"id":"W1","type":"player","x":28,"y":28,"label":"W1","color":"#0ea5e9"},{"id":"W2","type":"player","x":42,"y":50,"label":"W2","color":"#ef4444"},{"id":"A1","type":"player","x":12,"y":40,"label":"A1","color":"#94a3b8"},{"id":"D1","type":"player","x":12,"y":60,"label":"D1","color":"#94a3b8"}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":12,"y":40},"to":{"x":28,"y":28}},"style":{"color":"#22c55e"}},{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Timed rotation: 90s blocks"}}]'::jsonb);
END IF;

-- 11. End Zone
IF NOT EXISTS (SELECT 1 FROM public.drills WHERE name='End Zone' AND is_official=true) THEN
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'End Zone',
  'Two teams play possession — score by dribbling/passing into opposite end-zone. Rolling subs every 2 minutes.',
  'U9-U14', ARRAY['Possession','Forward play','Decision-making'], 15, 10,
  ARRAY['8 cones','Balls','Bibs'],
  ARRAY['Penetrate when possible','Width and depth','Receive on the half-turn','Defensive shape'],
  'Add target players in end-zones.',
  'No defenders in end-zones.',
  'club', true, 'medium') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 4000, 'Set-up: 30x20 pitch with two end-zones. 4v4. W1/W2 (blue) and W3/W4 (red).',
'[{"id":"c1","type":"cone","x":20,"y":20},{"id":"c2","type":"cone","x":80,"y":20},{"id":"c3","type":"cone","x":80,"y":80},{"id":"c4","type":"cone","x":20,"y":80},{"id":"A1","type":"player","x":35,"y":65,"label":"A1","color":"#0ea5e9"},{"id":"A2","type":"player","x":50,"y":65,"label":"A2","color":"#0ea5e9"},{"id":"A3","type":"player","x":65,"y":65,"label":"A3","color":"#0ea5e9"},{"id":"A4","type":"player","x":50,"y":75,"label":"A4","color":"#0ea5e9"},{"id":"B1","type":"player","x":35,"y":35,"label":"B1","color":"#ef4444"},{"id":"B2","type":"player","x":50,"y":35,"label":"B2","color":"#ef4444"},{"id":"B3","type":"player","x":65,"y":35,"label":"B3","color":"#ef4444"},{"id":"B4","type":"player","x":50,"y":25,"label":"B4","color":"#ef4444"},{"id":"W1","type":"player","x":10,"y":70,"label":"W1","color":"#94a3b8"},{"id":"W2","type":"player","x":10,"y":80,"label":"W2","color":"#94a3b8"},{"id":"W3","type":"player","x":10,"y":20,"label":"W3","color":"#94a3b8"},{"id":"W4","type":"player","x":10,"y":30,"label":"W4","color":"#94a3b8"},{"id":"b1","type":"ball","x":52,"y":67}]'::jsonb,
'[{"id":"z1","type":"zone","geometry":{"x":20,"y":15,"width":60,"height":8},"style":{"color":"#22c55e","opacity":0.18}},{"id":"z2","type":"zone","geometry":{"x":20,"y":77,"width":60,"height":8},"style":{"color":"#22c55e","opacity":0.18}}]'::jsonb),
(d_id, 1, 4000, 'A2 plays through to A3.',
'[{"id":"A3","type":"player","x":68,"y":48,"label":"A3","color":"#0ea5e9"},{"id":"b1","type":"ball","x":68,"y":48}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":58},"to":{"x":68,"y":48}},"style":{"color":"#fbbf24"}}]'::jsonb),
(d_id, 2, 4000, 'A3 dribbles into far green zone — Team A scores.',
'[{"id":"A3","type":"player","x":62,"y":22,"label":"A3","color":"#0ea5e9"},{"id":"b1","type":"ball","x":62,"y":20}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":68,"y":48},"to":{"x":62,"y":20}},"style":{"color":"#fbbf24","width":3}}]'::jsonb),
(d_id, 3, 4000, '2-min mark — W1 in for A4, W3 in for B4.',
'[{"id":"W1","type":"player","x":50,"y":75,"label":"W1","color":"#0ea5e9"},{"id":"W3","type":"player","x":50,"y":25,"label":"W3","color":"#ef4444"},{"id":"A4","type":"player","x":10,"y":70,"label":"A4","color":"#94a3b8"},{"id":"B4","type":"player","x":10,"y":20,"label":"B4","color":"#94a3b8"}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":10,"y":70},"to":{"x":50,"y":75}},"style":{"color":"#22c55e"}}]'::jsonb);
END IF;

-- 12. Four Goal Football
IF NOT EXISTS (SELECT 1 FROM public.drills WHERE name='Four Goal Football' AND is_official=true) THEN
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'Four Goal Football',
  'Each team defends two diagonal mini-goals and attacks two on opposite sides.',
  'U9-U14', ARRAY['Switching play','Scanning','Decision-making'], 15, 10,
  ARRAY['4 mini-goals','Cones','Bibs','Balls'],
  ARRAY['Scan to find unguarded goal','Switch play quickly','Press the ball, cover spare goal','Communicate'],
  'Reduce to 3v3.',
  'Add a neutral player.',
  'club', true, 'medium') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 4000, 'Set-up: 4 mini-goals diagonally. 4v4 plus 2 W per side.',
'[{"id":"gA1","type":"mini-goal","x":15,"y":30},{"id":"gA2","type":"mini-goal","x":85,"y":70},{"id":"gB1","type":"mini-goal","x":85,"y":30},{"id":"gB2","type":"mini-goal","x":15,"y":70},{"id":"A1","type":"player","x":35,"y":40,"label":"A1","color":"#0ea5e9"},{"id":"A2","type":"player","x":55,"y":50,"label":"A2","color":"#0ea5e9"},{"id":"A3","type":"player","x":45,"y":60,"label":"A3","color":"#0ea5e9"},{"id":"A4","type":"player","x":65,"y":35,"label":"A4","color":"#0ea5e9"},{"id":"B1","type":"player","x":40,"y":50,"label":"B1","color":"#ef4444"},{"id":"B2","type":"player","x":60,"y":60,"label":"B2","color":"#ef4444"},{"id":"B3","type":"player","x":35,"y":65,"label":"B3","color":"#ef4444"},{"id":"B4","type":"player","x":70,"y":50,"label":"B4","color":"#ef4444"},{"id":"W1","type":"player","x":10,"y":50,"label":"W1","color":"#94a3b8"},{"id":"W2","type":"player","x":90,"y":50,"label":"W2","color":"#94a3b8"},{"id":"b1","type":"ball","x":52,"y":50}]'::jsonb,
'[]'::jsonb),
(d_id, 1, 4000, 'A2 switches play to A4 with long pass.',
'[{"id":"A4","type":"player","x":68,"y":62,"label":"A4","color":"#0ea5e9"},{"id":"b1","type":"ball","x":68,"y":62}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":52,"y":50},"to":{"x":68,"y":62}},"style":{"color":"#fbbf24","width":3}}]'::jsonb),
(d_id, 2, 4000, 'A4 finishes into gA2.',
'[{"id":"A4","type":"player","x":78,"y":68,"label":"A4","color":"#0ea5e9"},{"id":"b1","type":"ball","x":85,"y":70}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":68,"y":62},"to":{"x":85,"y":70}},"style":{"color":"#fbbf24","width":3}}]'::jsonb),
(d_id, 3, 4000, 'Goal — W1 swaps for A1; W2 swaps for B4.',
'[{"id":"W1","type":"player","x":35,"y":40,"label":"W1","color":"#0ea5e9"},{"id":"A1","type":"player","x":10,"y":50,"label":"A1","color":"#94a3b8"},{"id":"W2","type":"player","x":70,"y":50,"label":"W2","color":"#ef4444"},{"id":"B4","type":"player","x":90,"y":50,"label":"B4","color":"#94a3b8"}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":10,"y":50},"to":{"x":35,"y":40}},"style":{"color":"#22c55e"}},{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Rotation after each goal"}}]'::jsonb);
END IF;

-- 13. Four-Sided Football
IF NOT EXISTS (SELECT 1 FROM public.drills WHERE name='Four-Sided Football' AND is_official=true) THEN
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'Four-Sided Football',
  'Four small teams play simultaneously — each defends a goal on one side.',
  'U10-U14', ARRAY['Awareness','Pressing','Decision-making'], 15, 12,
  ARRAY['4 mini-goals','Cones','4 sets of bibs','Balls'],
  ARRAY['Scan all 360°','Press as a unit','Cover team-mate''s goal','Sharp turns and short passes'],
  'Two balls in play.',
  'Three teams only.',
  'club', true, 'large') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 4000, 'Set-up: 4 mini-goals on N/E/S/W. 3 players per team. W rotate every 2 mins.',
'[{"id":"gN","type":"mini-goal","x":50,"y":12},{"id":"gE","type":"mini-goal","x":88,"y":50},{"id":"gS","type":"mini-goal","x":50,"y":88},{"id":"gW","type":"mini-goal","x":12,"y":50},{"id":"N1","type":"player","x":42,"y":30,"label":"N1","color":"#0ea5e9"},{"id":"N2","type":"player","x":58,"y":30,"label":"N2","color":"#0ea5e9"},{"id":"N3","type":"player","x":50,"y":40,"label":"N3","color":"#0ea5e9"},{"id":"E1","type":"player","x":70,"y":42,"label":"E1","color":"#ef4444"},{"id":"E2","type":"player","x":70,"y":58,"label":"E2","color":"#ef4444"},{"id":"E3","type":"player","x":62,"y":50,"label":"E3","color":"#ef4444"},{"id":"S1","type":"player","x":42,"y":70,"label":"S1","color":"#22c55e"},{"id":"S2","type":"player","x":58,"y":70,"label":"S2","color":"#22c55e"},{"id":"S3","type":"player","x":50,"y":60,"label":"S3","color":"#22c55e"},{"id":"WP1","type":"player","x":30,"y":42,"label":"W1","color":"#fbbf24"},{"id":"WP2","type":"player","x":30,"y":58,"label":"W2","color":"#fbbf24"},{"id":"WP3","type":"player","x":38,"y":50,"label":"W3","color":"#fbbf24"},{"id":"b1","type":"ball","x":52,"y":50}]'::jsonb,
'[]'::jsonb),
(d_id, 1, 4000, 'N3 plays to N2 — attacks east goal.',
'[{"id":"N2","type":"player","x":68,"y":40,"label":"N2","color":"#0ea5e9"},{"id":"b1","type":"ball","x":68,"y":40}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":52,"y":42},"to":{"x":68,"y":40}},"style":{"color":"#fbbf24"}}]'::jsonb),
(d_id, 2, 4000, 'N2 finishes into gE — N team scores.',
'[{"id":"N2","type":"player","x":80,"y":48,"label":"N2","color":"#0ea5e9"},{"id":"b1","type":"ball","x":88,"y":50}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":68,"y":40},"to":{"x":88,"y":50}},"style":{"color":"#fbbf24","width":3}}]'::jsonb),
(d_id, 3, 4000, '2-min mark — one waiter rotates onto each team.',
'[]'::jsonb,
'[{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Each team rotates one player every 2 min"}}]'::jsonb);
END IF;

-- 14. Receive-Turn-Pass (3 zone)
IF NOT EXISTS (SELECT 1 FROM public.drills WHERE name='Receive-Turn-Pass (3 zone)' AND is_official=true) THEN
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'Receive-Turn-Pass (3 zone)',
  'Middle player receives, turns and plays to target. Players rotate through all three roles.',
  'U10-U14', ARRAY['First touch','Turning','Passing'], 12, 9,
  ARRAY['1 ball per group','6 cones'],
  ARRAY['Open hips before receiving','Touch into space','Scan over shoulder','Quality of weight'],
  'Add passive defender on turner.',
  'Two-touch allowed.',
  'club', true, 'small') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 4000, 'Set-up: 3 cones in a line. F (feeder), T (turner), R (receiver). W1/W2 on side.',
'[{"id":"cF","type":"cone","x":15,"y":50},{"id":"cT","type":"cone","x":50,"y":50},{"id":"cR","type":"cone","x":85,"y":50},{"id":"F","type":"player","x":15,"y":50,"label":"F","color":"#0ea5e9"},{"id":"T","type":"player","x":50,"y":50,"label":"T","color":"#0ea5e9"},{"id":"R","type":"player","x":85,"y":50,"label":"R","color":"#0ea5e9"},{"id":"W1","type":"player","x":50,"y":15,"label":"W1","color":"#94a3b8"},{"id":"W2","type":"player","x":50,"y":85,"label":"W2","color":"#94a3b8"},{"id":"b1","type":"ball","x":17,"y":50}]'::jsonb,
'[]'::jsonb),
(d_id, 1, 4000, 'F passes into T''s feet.',
'[{"id":"b1","type":"ball","x":35,"y":50}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":17,"y":50},"to":{"x":48,"y":50}},"style":{"color":"#fbbf24"}},{"id":"sm1","type":"step-marker","geometry":{"x":42,"y":42,"number":1}}]'::jsonb),
(d_id, 2, 4000, 'T opens body, plays to R.',
'[{"id":"T","type":"player","x":58,"y":50,"label":"T","color":"#0ea5e9"},{"id":"b1","type":"ball","x":75,"y":50}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":58,"y":50},"to":{"x":83,"y":50}},"style":{"color":"#fbbf24"}},{"id":"sm1","type":"step-marker","geometry":{"x":68,"y":42,"number":2}}]'::jsonb),
(d_id, 3, 4000, 'Rotate roles: F→T, T→R, R→F. W1/W2 step in if any player rests.',
'[{"id":"R","type":"player","x":15,"y":50,"label":"R","color":"#0ea5e9"},{"id":"F","type":"player","x":50,"y":50,"label":"F","color":"#0ea5e9"},{"id":"T","type":"player","x":85,"y":50,"label":"T","color":"#0ea5e9"},{"id":"b1","type":"ball","x":17,"y":50}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":15,"y":50},"to":{"x":50,"y":50}},"style":{"color":"#22c55e"}},{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Players rotate clockwise"}}]'::jsonb);
END IF;

-- 15. Pressure Cooker
IF NOT EXISTS (SELECT 1 FROM public.drills WHERE name='Pressure Cooker' AND is_official=true) THEN
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'Pressure Cooker',
  'Attacker has 5s to beat defender and finish. Server feeds; queue rotates after each rep.',
  'U10-U14', ARRAY['Finishing','1v1 attacking','Speed of play'], 12, 8,
  ARRAY['1 mini-goal','Balls','4 cones','Bibs'],
  ARRAY['First touch toward goal','Decide: shoot or beat','Defender slows attacker','Strike on the move'],
  'Defender fully active; reduce time.',
  'No defender for first reps.',
  'club', true, 'small') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 4000, 'Set-up: mini-goal at top. S (server) on side. A on cone, D in front of goal. W1-W4 wait.',
'[{"id":"g","type":"mini-goal","x":50,"y":12},{"id":"c1","type":"cone","x":30,"y":40},{"id":"c2","type":"cone","x":50,"y":75},{"id":"S","type":"player","x":15,"y":50,"label":"S","color":"#f97316"},{"id":"D","type":"player","x":50,"y":40,"label":"D","color":"#ef4444"},{"id":"A","type":"player","x":50,"y":75,"label":"A","color":"#0ea5e9"},{"id":"W1","type":"player","x":85,"y":75,"label":"W1","color":"#94a3b8"},{"id":"W2","type":"player","x":85,"y":80,"label":"W2","color":"#94a3b8"},{"id":"W3","type":"player","x":85,"y":85,"label":"W3","color":"#94a3b8"},{"id":"W4","type":"player","x":85,"y":90,"label":"W4","color":"#94a3b8"},{"id":"b1","type":"ball","x":17,"y":50}]'::jsonb,
'[{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"5s to score"}}]'::jsonb),
(d_id, 1, 4000, 'S passes into A; D engages.',
'[{"id":"A","type":"player","x":50,"y":68,"label":"A","color":"#0ea5e9"},{"id":"D","type":"player","x":50,"y":50,"label":"D","color":"#ef4444"},{"id":"b1","type":"ball","x":50,"y":68}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":17,"y":50},"to":{"x":50,"y":68}},"style":{"color":"#fbbf24"}}]'::jsonb),
(d_id, 2, 4000, 'A beats D, finishes into mini-goal.',
'[{"id":"A","type":"player","x":42,"y":28,"label":"A","color":"#0ea5e9"},{"id":"b1","type":"ball","x":50,"y":15}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":42,"y":28},"to":{"x":50,"y":13}},"style":{"color":"#fbbf24","width":3}}]'::jsonb),
(d_id, 3, 4000, 'Rotation: A→S, S→D, D→back of W queue, W1→new attacker.',
'[{"id":"A","type":"player","x":15,"y":50,"label":"A","color":"#f97316"},{"id":"S","type":"player","x":50,"y":40,"label":"S","color":"#ef4444"},{"id":"W1","type":"player","x":50,"y":75,"label":"W1","color":"#0ea5e9"},{"id":"D","type":"player","x":85,"y":75,"label":"D","color":"#94a3b8"}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":85,"y":75},"to":{"x":50,"y":75}},"style":{"color":"#22c55e"}},{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Roles rotate every rep"}}]'::jsonb);
END IF;

-- 16. Numbers Game
IF NOT EXISTS (SELECT 1 FROM public.drills WHERE name='Numbers Game' AND is_official=true) THEN
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'Numbers Game',
  'Players numbered 1-N jog freely. Coach calls a number — that player attacks vs defender.',
  'U10-U14', ARRAY['Reaction','1v1 / 2v1','Decision-making'], 12, 8,
  ARRAY['1 full goal','Bibs numbered','Balls','4 cones'],
  ARRAY['React instantly','Communicate when 2v1','Defender delays','Quality finish'],
  'Coach calls 2-3 numbers (2v2/3v2).',
  'Single number; passive defender.',
  'club', true, 'medium') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 4000, 'Set-up: full goal. 6 numbered players jog inside grid. Coach holds balls. W1/W2 on side.',
'[{"id":"goal","type":"full-goal","x":50,"y":12},{"id":"c1","type":"cone","x":25,"y":35},{"id":"c2","type":"cone","x":75,"y":35},{"id":"c3","type":"cone","x":75,"y":80},{"id":"c4","type":"cone","x":25,"y":80},{"id":"C","type":"player","x":15,"y":50,"label":"C","color":"#f97316"},{"id":"p1","type":"player","x":35,"y":50,"label":"1","color":"#0ea5e9"},{"id":"p2","type":"player","x":50,"y":48,"label":"2","color":"#0ea5e9"},{"id":"p3","type":"player","x":65,"y":52,"label":"3","color":"#0ea5e9"},{"id":"p4","type":"player","x":40,"y":65,"label":"4","color":"#0ea5e9"},{"id":"p5","type":"player","x":55,"y":68,"label":"5","color":"#0ea5e9"},{"id":"p6","type":"player","x":68,"y":68,"label":"6","color":"#0ea5e9"},{"id":"W1","type":"player","x":12,"y":75,"label":"W1","color":"#94a3b8"},{"id":"W2","type":"player","x":12,"y":85,"label":"W2","color":"#94a3b8"}]'::jsonb,
'[{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Coach holds ball, calls numbers"}}]'::jsonb),
(d_id, 1, 4000, 'Coach calls "3 vs 5" — 3 attacks, 5 defends.',
'[{"id":"p3","type":"player","x":58,"y":48,"label":"3","color":"#0ea5e9"},{"id":"p5","type":"player","x":50,"y":35,"label":"5","color":"#ef4444"},{"id":"b1","type":"ball","x":58,"y":50}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":17,"y":50},"to":{"x":58,"y":48}},"style":{"color":"#fbbf24"}}]'::jsonb),
(d_id, 2, 4000, '3 beats 5 and finishes.',
'[{"id":"p3","type":"player","x":48,"y":22,"label":"3","color":"#0ea5e9"},{"id":"b1","type":"ball","x":48,"y":15}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":58,"y":48},"to":{"x":50,"y":13}},"style":{"color":"#fbbf24","width":3}}]'::jsonb),
(d_id, 3, 4000, 'Round done — 3 and 5 jog to back of W queue; W1/W2 take numbers 3 & 5.',
'[{"id":"W1","type":"player","x":65,"y":52,"label":"3","color":"#0ea5e9"},{"id":"W2","type":"player","x":55,"y":68,"label":"5","color":"#0ea5e9"},{"id":"p3","type":"player","x":12,"y":75,"label":"W3","color":"#94a3b8"},{"id":"p5","type":"player","x":12,"y":85,"label":"W5","color":"#94a3b8"}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":12,"y":75},"to":{"x":65,"y":52}},"style":{"color":"#22c55e"}},{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"W rotates in by number"}}]'::jsonb);
END IF;

-- 17. Combination to goal (THE FIXED ONE)
IF NOT EXISTS (SELECT 1 FROM public.drills WHERE name='Combination to goal' AND is_official=true) THEN
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'Combination to goal',
  'Wall-pass combination — A passes to B, B sets back to A, A finishes. Players rotate.',
  'U10-U14', ARRAY['Combination play','Finishing','Wall pass'], 12, 9,
  ARRAY['1 full goal','Balls','4 cones'],
  ARRAY['Pass weight: firm into B''s feet','B opens body, lays first time','A runs onto lay-off','Finish low and across'],
  'Add passive defender on B.',
  'B controls then passes back.',
  'club', true, 'medium') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 4000, 'Set-up: full goal top. A on cone with ball at 30y. B on cone in middle. W1-W4 in queue.',
'[{"id":"goal","type":"full-goal","x":50,"y":10},{"id":"c1","type":"cone","x":50,"y":75},{"id":"c2","type":"cone","x":50,"y":40},{"id":"A","type":"player","x":50,"y":75,"label":"A","color":"#0ea5e9"},{"id":"B","type":"player","x":50,"y":40,"label":"B","color":"#0ea5e9"},{"id":"W1","type":"player","x":80,"y":80,"label":"W1","color":"#94a3b8"},{"id":"W2","type":"player","x":80,"y":85,"label":"W2","color":"#94a3b8"},{"id":"W3","type":"player","x":80,"y":90,"label":"W3","color":"#94a3b8"},{"id":"W4","type":"player","x":80,"y":95,"label":"W4","color":"#94a3b8"},{"id":"b1","type":"ball","x":52,"y":75}]'::jsonb,
'[]'::jsonb),
(d_id, 1, 4000, 'A passes into B''s feet.',
'[{"id":"A","type":"player","x":50,"y":68,"label":"A","color":"#0ea5e9"},{"id":"b1","type":"ball","x":50,"y":48}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":52,"y":75},"to":{"x":50,"y":42}},"style":{"color":"#fbbf24"}},{"id":"sm1","type":"step-marker","geometry":{"x":42,"y":58,"number":1}}]'::jsonb),
(d_id, 2, 4000, 'B lays off first time into A''s path.',
'[{"id":"A","type":"player","x":48,"y":50,"label":"A","color":"#0ea5e9"},{"id":"b1","type":"ball","x":45,"y":48}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":40},"to":{"x":42,"y":52}},"style":{"color":"#fbbf24"}},{"id":"sm1","type":"step-marker","geometry":{"x":42,"y":48,"number":2}}]'::jsonb),
(d_id, 3, 4000, 'A runs on, finishes — 3 touches max.',
'[{"id":"A","type":"player","x":42,"y":30,"label":"A","color":"#0ea5e9"},{"id":"b1","type":"ball","x":48,"y":13}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":42,"y":30},"to":{"x":48,"y":12}},"style":{"color":"#fbbf24","width":3}},{"id":"sm1","type":"step-marker","geometry":{"x":50,"y":20,"number":3}}]'::jsonb),
(d_id, 4, 4000, 'Rotation: A→B, B→back of W queue, W1→new A.',
'[{"id":"W1","type":"player","x":50,"y":75,"label":"W1","color":"#0ea5e9"},{"id":"A","type":"player","x":50,"y":40,"label":"A","color":"#0ea5e9"},{"id":"B","type":"player","x":80,"y":80,"label":"B","color":"#94a3b8"},{"id":"b1","type":"ball","x":52,"y":75}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":80,"y":80},"to":{"x":50,"y":75}},"style":{"color":"#22c55e"}},{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Rotation A→B→queue→A"}}]'::jsonb);
END IF;

END $$;
