
-- Seed 10 additional official drills inspired by Football Australia coaching resources (Sessions 11-20)
-- Coordinate system: 0-100, x=horizontal, y=vertical (0=top)

DO $$
DECLARE
  seed_owner uuid := '00000000-0000-0000-0000-000000000000';
  d_id uuid;
BEGIN

-- 1. FA S11 — Close-control dribble box (U6-U9)
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'Close-control dribble box', 'Players dribble inside a small box using all surfaces of the foot, changing direction on coach calls.',
  'U6-U9', ARRAY['Dribbling','Ball mastery','Coordination'], 10, 8,
  ARRAY['1 ball per player','8 cones','Bibs'],
  ARRAY['Use both feet','Small touches, head up','Change direction sharply','Shield ball when close to others'],
  'Coach calls "freeze, turn, swap" – players react quickly while keeping control.',
  'Larger box, fewer players, walking pace.',
  'club', true, 'small') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 4000, 'Set-up: 4 cones form a 20x20 box; 6 players dribble inside.',
'[{"id":"c1","type":"cone","x":30,"y":30},{"id":"c2","type":"cone","x":70,"y":30},{"id":"c3","type":"cone","x":70,"y":70},{"id":"c4","type":"cone","x":30,"y":70},
{"id":"p1","type":"player","x":40,"y":40,"label":"1","color":"#0ea5e9"},{"id":"p2","type":"player","x":55,"y":42,"label":"2","color":"#0ea5e9"},
{"id":"p3","type":"player","x":62,"y":58,"label":"3","color":"#0ea5e9"},{"id":"p4","type":"player","x":45,"y":62,"label":"4","color":"#0ea5e9"},
{"id":"p5","type":"player","x":50,"y":50,"label":"5","color":"#0ea5e9"},{"id":"p6","type":"player","x":38,"y":52,"label":"6","color":"#0ea5e9"}]'::jsonb,
'[{"id":"z1","type":"zone","geometry":{"x":30,"y":30,"width":40,"height":40},"style":{"color":"#22c55e","opacity":0.15}},
{"id":"t1","type":"text","geometry":{"x":50,"y":25,"text":"Dribble inside the box"}}]'::jsonb);

-- 2. FA S12 — Line shooting U6-U8 alt (already have one, name differently)
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'Two-cone shooting gates', 'Players dribble between two cone gates and shoot at a small goal — develops accuracy and decision-making.',
  'U6-U8', ARRAY['Finishing','Dribbling','Accuracy'], 12, 6,
  ARRAY['6 cones','3 balls','1 mini-goal'],
  ARRAY['Plant non-kicking foot','Strike with laces','Eyes on target before shot','Follow up the shot'],
  'Add a passive defender between the gates.',
  'Move shooter closer; remove dribble.',
  'club', true, 'small') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 4000, 'Set-up: two gates lead to a mini-goal; players queue and shoot in turn.',
'[{"id":"g","type":"mini-goal","x":50,"y":15,"rotation":0},
{"id":"gL1","type":"cone","x":40,"y":45},{"id":"gL2","type":"cone","x":40,"y":55},
{"id":"gR1","type":"cone","x":60,"y":45},{"id":"gR2","type":"cone","x":60,"y":55},
{"id":"p1","type":"player","x":45,"y":80,"label":"1","color":"#0ea5e9"},
{"id":"p2","type":"player","x":55,"y":80,"label":"2","color":"#0ea5e9"},
{"id":"p3","type":"player","x":50,"y":88,"label":"3","color":"#0ea5e9"},
{"id":"b1","type":"ball","x":45,"y":78}]'::jsonb,
'[{"id":"a1","type":"arrow-dashed","geometry":{"from":{"x":45,"y":78},"to":{"x":40,"y":50}},"style":{"color":"#a78bfa"}},
{"id":"a2","type":"arrow-solid","geometry":{"from":{"x":40,"y":50},"to":{"x":50,"y":18}},"style":{"color":"#fbbf24"}},
{"id":"t1","type":"text","geometry":{"x":50,"y":62,"text":"Dribble through gate, shoot"}}]'::jsonb);

-- 3. FA S13 — Striking from a moving ball U9-U12
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'Strike from a moving ball U9-U12', 'Server rolls the ball; striker meets it on the move and finishes first time on a full goal.',
  'U9-U12', ARRAY['Finishing','First touch','Striking technique'], 15, 8,
  ARRAY['10 balls','4 cones','1 full goal'],
  ARRAY['Approach ball at angle','Lock ankle, strike through middle','Shoulder over the ball','First-time finish where possible'],
  'Add a recovering defender chasing the striker.',
  'Server passes static ball; striker takes one touch first.',
  'club', true, 'medium') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 4000, 'Server (S) rolls a ball into the path of striker (A) running in.',
'[{"id":"goal","type":"full-goal","x":50,"y":10,"rotation":0},
{"id":"c1","type":"cone","x":35,"y":75},{"id":"c2","type":"cone","x":65,"y":75},
{"id":"S","type":"player","x":30,"y":50,"label":"S","color":"#f97316"},
{"id":"A","type":"player","x":55,"y":75,"label":"A","color":"#0ea5e9"},
{"id":"q1","type":"player","x":62,"y":85,"label":"2","color":"#0ea5e9"},
{"id":"q2","type":"player","x":70,"y":85,"label":"3","color":"#0ea5e9"},
{"id":"b1","type":"ball","x":32,"y":50}]'::jsonb,
'[{"id":"a1","type":"arrow-dashed","geometry":{"from":{"x":32,"y":50},"to":{"x":50,"y":45}},"style":{"color":"#a78bfa"}},
{"id":"a2","type":"arrow-solid","geometry":{"from":{"x":55,"y":75},"to":{"x":50,"y":45}},"style":{"color":"#fbbf24"}},
{"id":"a3","type":"arrow-solid","geometry":{"from":{"x":50,"y":45},"to":{"x":50,"y":13}},"style":{"color":"#fbbf24","width":3}},
{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Server rolls, striker meets ball"}}]'::jsonb);

-- 4. FA S14 — Receive on the half-turn
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'Receive on the half-turn', '3-player line drill: middle player receives a pass, opens body and plays forward to third player.',
  'U10-U13', ARRAY['First touch','Passing','Body shape'], 12, 9,
  ARRAY['1 ball per group','6 cones'],
  ARRAY['Open hips before ball arrives','Take first touch into space','Scan over shoulder','Quality of weight on second pass'],
  'Add a passive defender on the receiver.',
  'Receive, control, then play (two touches allowed).',
  'club', true, 'small') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 4000, 'A passes to B; B takes half-turn and plays to C.',
'[{"id":"A","type":"player","x":20,"y":50,"label":"A","color":"#0ea5e9"},
{"id":"B","type":"player","x":50,"y":50,"label":"B","color":"#0ea5e9"},
{"id":"C","type":"player","x":80,"y":50,"label":"C","color":"#0ea5e9"},
{"id":"c1","type":"cone","x":20,"y":58},{"id":"c2","type":"cone","x":50,"y":58},{"id":"c3","type":"cone","x":80,"y":58},
{"id":"b1","type":"ball","x":22,"y":50}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":22,"y":50},"to":{"x":48,"y":50}},"style":{"color":"#fbbf24"}},
{"id":"a2","type":"arrow-solid","geometry":{"from":{"x":52,"y":50},"to":{"x":78,"y":50}},"style":{"color":"#fbbf24"}},
{"id":"sm","type":"step-marker","geometry":{"x":50,"y":42,"number":1}},
{"id":"t1","type":"text","geometry":{"x":50,"y":35,"text":"B opens up, plays through"}}]'::jsonb);

-- 5. FA S15 — Volley finishing from cross
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'Volley finish from cross', 'Wide server delivers a cross; striker finishes first time at the near or far post.',
  'U11-U14', ARRAY['Finishing','Volleys','Crossing'], 15, 8,
  ARRAY['10 balls','4 cones','1 full goal','Bibs'],
  ARRAY['Attack the ball, don''t wait','Plant foot pointed at target','Knee over ball','Choose near or far post early'],
  'Add a defender marking the striker.',
  'Server passes along the ground for side-foot finish.',
  'club', true, 'medium') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 4000, 'Wide server (W) crosses to striker (A) attacking the box.',
'[{"id":"goal","type":"full-goal","x":50,"y":10,"rotation":0},
{"id":"W","type":"player","x":85,"y":40,"label":"W","color":"#0ea5e9"},
{"id":"A","type":"player","x":60,"y":35,"label":"A","color":"#0ea5e9"},
{"id":"B","type":"player","x":40,"y":40,"label":"B","color":"#0ea5e9"},
{"id":"q1","type":"player","x":85,"y":80,"label":"2","color":"#0ea5e9"},
{"id":"b1","type":"ball","x":85,"y":42}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":85,"y":42},"to":{"x":55,"y":25}},"style":{"color":"#fbbf24","width":3}},
{"id":"a2","type":"arrow-dashed","geometry":{"from":{"x":60,"y":35},"to":{"x":50,"y":22}},"style":{"color":"#a78bfa"}},
{"id":"a3","type":"arrow-solid","geometry":{"from":{"x":50,"y":22},"to":{"x":45,"y":13}},"style":{"color":"#fbbf24","width":3}},
{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Cross from W, finish at near post"}}]'::jsonb);

-- 6. FA S16 — 1v1 attacking with end-zone
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, '1v1 to end-zone', 'Attacker tries to dribble across an end-line zone vs a defender — develops close-quarter beating skills.',
  'U8-U12', ARRAY['1v1 attacking','Dribbling','Change of direction'], 12, 6,
  ARRAY['8 cones','Balls','Bibs'],
  ARRAY['Approach defender at speed','Lower body to change direction','Use feint or stepover','Accelerate after the move'],
  'Defender becomes fully active; add second defender.',
  'Defender stays passive; widen the channel.',
  'club', true, 'small') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 4000, 'Attacker (A) starts with ball; defender (D) faces them; A must cross the green end-zone.',
'[{"id":"c1","type":"cone","x":25,"y":20},{"id":"c2","type":"cone","x":75,"y":20},
{"id":"c3","type":"cone","x":25,"y":80},{"id":"c4","type":"cone","x":75,"y":80},
{"id":"A","type":"player","x":50,"y":75,"label":"A","color":"#0ea5e9"},
{"id":"D","type":"player","x":50,"y":45,"label":"D","color":"#ef4444"},
{"id":"b1","type":"ball","x":52,"y":75}]'::jsonb,
'[{"id":"z1","type":"zone","geometry":{"x":25,"y":20,"width":50,"height":10},"style":{"color":"#22c55e","opacity":0.2}},
{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":75},"to":{"x":40,"y":40}},"style":{"color":"#fbbf24"}},
{"id":"a2","type":"arrow-solid","geometry":{"from":{"x":40,"y":40},"to":{"x":55,"y":25}},"style":{"color":"#fbbf24"}},
{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Beat D, dribble into green zone"}}]'::jsonb);

-- 7. FA S17 — Outside-foot dribble slalom
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'Outside-foot slalom', 'Players weave through cones using only the outside of the foot — develops touch and balance.',
  'U7-U10', ARRAY['Dribbling','Ball mastery','Both feet'], 8, 6,
  ARRAY['5 cones per lane','Balls'],
  ARRAY['Outside of foot only','Small repeated touches','Knees bent, low centre of gravity','Head up between cones'],
  'Race against partner; finish with shot at mini-goal.',
  'Wider cone spacing; allow inside foot if needed.',
  'club', true, 'small') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 4000, 'Vertical line of 5 cones; player dribbles weaving through.',
'[{"id":"c1","type":"cone","x":50,"y":20},{"id":"c2","type":"cone","x":50,"y":35},
{"id":"c3","type":"cone","x":50,"y":50},{"id":"c4","type":"cone","x":50,"y":65},{"id":"c5","type":"cone","x":50,"y":80},
{"id":"A","type":"player","x":50,"y":90,"label":"A","color":"#0ea5e9"},
{"id":"q1","type":"player","x":58,"y":92,"label":"2","color":"#0ea5e9"},
{"id":"b1","type":"ball","x":52,"y":90}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":88},"to":{"x":45,"y":78}},"style":{"color":"#fbbf24"}},
{"id":"a2","type":"arrow-solid","geometry":{"from":{"x":45,"y":78},"to":{"x":55,"y":63}},"style":{"color":"#fbbf24"}},
{"id":"a3","type":"arrow-solid","geometry":{"from":{"x":55,"y":63},"to":{"x":45,"y":48}},"style":{"color":"#fbbf24"}},
{"id":"a4","type":"arrow-solid","geometry":{"from":{"x":45,"y":48},"to":{"x":55,"y":33}},"style":{"color":"#fbbf24"}},
{"id":"a5","type":"arrow-solid","geometry":{"from":{"x":55,"y":33},"to":{"x":50,"y":15}},"style":{"color":"#fbbf24"}}]'::jsonb);

-- 8. FA S18 — Defender pressure & cover (1v1+1)
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'Pressure and cover', '1st defender pressures attacker; 2nd defender covers behind. Tests distance, angle and communication.',
  'U10-U14', ARRAY['Defending','1v1 defending','Communication'], 15, 8,
  ARRAY['Cones','Balls','Bibs','1 mini-goal'],
  ARRAY['First defender shows attacker one way','Second defender covers diagonally behind','Talk: "press!", "got cover!"','Stay on toes, don''t dive in'],
  'Add a third attacker to make it 2v3.',
  'Slow down to walking pace.',
  'club', true, 'medium') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 4000, 'Attacker A vs first defender D1 with D2 covering.',
'[{"id":"g","type":"mini-goal","x":50,"y":10,"rotation":0},
{"id":"A","type":"player","x":50,"y":80,"label":"A","color":"#0ea5e9"},
{"id":"D1","type":"player","x":50,"y":55,"label":"D1","color":"#ef4444"},
{"id":"D2","type":"player","x":40,"y":35,"label":"D2","color":"#ef4444"},
{"id":"b1","type":"ball","x":52,"y":80}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":80},"to":{"x":50,"y":58}},"style":{"color":"#fbbf24"}},
{"id":"a2","type":"arrow-dashed","geometry":{"from":{"x":50,"y":55},"to":{"x":45,"y":50}},"style":{"color":"#a78bfa"}},
{"id":"a3","type":"arrow-dashed","geometry":{"from":{"x":40,"y":35},"to":{"x":47,"y":42}},"style":{"color":"#a78bfa"}},
{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"D1 presses, D2 covers diagonally"}}]'::jsonb);

-- 9. FA S19 — 1v1 attacking with overlap option
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, '1v1 with overlap option', 'Attacker decides: take on defender 1v1 or release to overlapping team-mate, then finish on goal.',
  'U11-U14', ARRAY['1v1 attacking','Decision making','Combination play'], 15, 8,
  ARRAY['Cones','Balls','Bibs','1 full goal'],
  ARRAY['Read defender''s body shape','Commit defender before passing','Quality timing of overlap run','Finish with first touch when possible'],
  'Add second defender; small-sided 2v2.',
  'Defender starts deeper to give attacker time.',
  'club', true, 'medium') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 4000, 'A drives at D; B overlaps wide. A picks the best option.',
'[{"id":"goal","type":"full-goal","x":50,"y":10,"rotation":0},
{"id":"A","type":"player","x":45,"y":75,"label":"A","color":"#0ea5e9"},
{"id":"B","type":"player","x":25,"y":80,"label":"B","color":"#0ea5e9"},
{"id":"D","type":"player","x":50,"y":50,"label":"D","color":"#ef4444"},
{"id":"b1","type":"ball","x":47,"y":75}]'::jsonb,
'[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":45,"y":75},"to":{"x":48,"y":55}},"style":{"color":"#fbbf24"}},
{"id":"a2","type":"arrow-dashed","geometry":{"from":{"x":25,"y":80},"to":{"x":35,"y":50}},"style":{"color":"#a78bfa"}},
{"id":"a3","type":"arrow-solid","geometry":{"from":{"x":48,"y":55},"to":{"x":35,"y":50}},"style":{"color":"#fbbf24"}},
{"id":"a4","type":"arrow-solid","geometry":{"from":{"x":35,"y":50},"to":{"x":45,"y":13}},"style":{"color":"#fbbf24","width":3}},
{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Drive 1v1 or release to overlap"}}]'::jsonb);

-- 10. FA S20 — Finishing from rebound
INSERT INTO public.drills (owner_user_id, name, description, age_group, focus, duration_minutes, players_required, equipment, coaching_points, progression, regression, visibility, is_official, pitch_size)
VALUES (seed_owner, 'Rebound finishing', 'Coach plays a ball off a rebound board (or wall); striker reacts and finishes — promotes second-ball reactions.',
  'U10-U14', ARRAY['Finishing','Reactions','Movement'], 12, 6,
  ARRAY['Rebound board or wall','10 balls','1 full goal'],
  ARRAY['React quickly to second ball','Get body in line with rebound','Adjust feet before striking','Stay alive — follow up your shot'],
  'Add a defender pressuring from behind.',
  'Static ball delivered to feet by coach.',
  'club', true, 'medium') RETURNING id INTO d_id;
INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
(d_id, 0, 4000, 'Coach (C) plays ball off the rebound zone; striker (A) finishes the loose ball.',
'[{"id":"goal","type":"full-goal","x":50,"y":10,"rotation":0},
{"id":"C","type":"player","x":80,"y":60,"label":"C","color":"#f97316"},
{"id":"A","type":"player","x":50,"y":55,"label":"A","color":"#0ea5e9"},
{"id":"q1","type":"player","x":60,"y":80,"label":"2","color":"#0ea5e9"},
{"id":"q2","type":"player","x":68,"y":85,"label":"3","color":"#0ea5e9"},
{"id":"b1","type":"ball","x":80,"y":62}]'::jsonb,
'[{"id":"z1","type":"zone","geometry":{"x":20,"y":48,"width":15,"height":8},"style":{"color":"#22c55e","opacity":0.2}},
{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":80,"y":60},"to":{"x":28,"y":52}},"style":{"color":"#fbbf24"}},
{"id":"a2","type":"arrow-dashed","geometry":{"from":{"x":28,"y":52},"to":{"x":48,"y":50}},"style":{"color":"#a78bfa"}},
{"id":"a3","type":"arrow-solid","geometry":{"from":{"x":48,"y":50},"to":{"x":50,"y":13}},"style":{"color":"#fbbf24","width":3}},
{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Strike the rebound first time"}}]'::jsonb);

END $$;
