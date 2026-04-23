-- Rebuild "Line shooting U6-U8" with rotating performers.
-- Three different players (1, then 2, then 3) each take a rep within
-- the animation loop, with the queue shuffling forward after every rep.
--
-- Pitch: 0-100 % coordinates. Mini-goal at (50,12), cone at (50,55).
-- Initial queue (slots 1..7) at y=75: x = 39, 43, 47, 51, 55, 59, 63.

DO $$
DECLARE
  v_drill_id uuid;
BEGIN
  SELECT id INTO v_drill_id
  FROM public.drills
  WHERE name = 'Line shooting U6-U8' AND is_official = true
  LIMIT 1;

  IF v_drill_id IS NULL THEN
    RAISE EXCEPTION 'Drill "Line shooting U6-U8" not found';
  END IF;

  DELETE FROM public.drill_frames WHERE drill_id = v_drill_id;

  ----------------------------------------------------------------------
  -- Frame 0 — Setup: player 1 on the ball at the cone, queue waits.
  ----------------------------------------------------------------------
  INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
  VALUES (
    v_drill_id, 0, 1500,
    'Setup — player 1 at the cone with the ball, queue (2..7) waiting their turn.',
    $JSON$[
      {"id":"g1","type":"mini-goal","x":50,"y":12},
      {"id":"c1","type":"cone","x":50,"y":55,"rotation":0,"size":1,"color":"#f97316"},
      {"id":"p1","type":"player","x":50,"y":60,"label":"1","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p2","type":"player","x":39,"y":75,"label":"2","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p3","type":"player","x":43,"y":75,"label":"3","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p4","type":"player","x":47,"y":75,"label":"4","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p5","type":"player","x":51,"y":75,"label":"5","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p6","type":"player","x":55,"y":75,"label":"6","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p7","type":"player","x":59,"y":75,"label":"7","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"b1","type":"ball","x":50,"y":60,"rotation":0,"size":1,"color":"#f5f5f5"}
    ]$JSON$::jsonb,
    $JSON$[
      {"id":"t1","type":"text","geometry":{"x":50,"y":90,"text":"Wait your turn — 1 ball each"}}
    ]$JSON$::jsonb
  );

  ----------------------------------------------------------------------
  -- Frame 1 — Player 1 pushes the ball toward the goal (first touch).
  ----------------------------------------------------------------------
  INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
  VALUES (
    v_drill_id, 1, 1500,
    'Frame 1 — Player 1 pushes forward with their first touch.',
    $JSON$[
      {"id":"g1","type":"mini-goal","x":50,"y":12},
      {"id":"c1","type":"cone","x":50,"y":55,"rotation":0,"size":1,"color":"#f97316"},
      {"id":"p1","type":"player","x":50,"y":42,"label":"1","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p2","type":"player","x":39,"y":75,"label":"2","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p3","type":"player","x":43,"y":75,"label":"3","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p4","type":"player","x":47,"y":75,"label":"4","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p5","type":"player","x":51,"y":75,"label":"5","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p6","type":"player","x":55,"y":75,"label":"6","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p7","type":"player","x":59,"y":75,"label":"7","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"b1","type":"ball","x":50,"y":40,"rotation":0,"size":1,"color":"#f5f5f5"}
    ]$JSON$::jsonb,
    $JSON$[
      {"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":58},"to":{"x":50,"y":40}},"style":{"color":"#fbbf24"}}
    ]$JSON$::jsonb
  );

  ----------------------------------------------------------------------
  -- Frame 2 — Player 1 strikes; ball flies into the goal.
  ----------------------------------------------------------------------
  INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
  VALUES (
    v_drill_id, 2, 1500,
    'Frame 2 — Player 1 strikes! Goal!',
    $JSON$[
      {"id":"g1","type":"mini-goal","x":50,"y":12},
      {"id":"c1","type":"cone","x":50,"y":55,"rotation":0,"size":1,"color":"#f97316"},
      {"id":"p1","type":"player","x":50,"y":40,"label":"1","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p2","type":"player","x":39,"y":75,"label":"2","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p3","type":"player","x":43,"y":75,"label":"3","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p4","type":"player","x":47,"y":75,"label":"4","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p5","type":"player","x":51,"y":75,"label":"5","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p6","type":"player","x":55,"y":75,"label":"6","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p7","type":"player","x":59,"y":75,"label":"7","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"b1","type":"ball","x":50,"y":12,"rotation":0,"size":1,"color":"#f5f5f5"}
    ]$JSON$::jsonb,
    $JSON$[
      {"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":38},"to":{"x":50,"y":14}},"style":{"color":"#22c55e"}},
      {"id":"t1","type":"text","geometry":{"x":65,"y":14,"text":"Goal!"}}
    ]$JSON$::jsonb
  );

  ----------------------------------------------------------------------
  -- Frame 3 — Rotation. Player 1 jogs to back of line, player 2 steps
  -- onto the ball at the cone, queue shuffles one slot forward.
  ----------------------------------------------------------------------
  INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
  VALUES (
    v_drill_id, 3, 1500,
    'Frame 3 — Rotate! Player 1 jogs back, player 2 steps onto the ball, line shuffles forward.',
    $JSON$[
      {"id":"g1","type":"mini-goal","x":50,"y":12},
      {"id":"c1","type":"cone","x":50,"y":55,"rotation":0,"size":1,"color":"#f97316"},
      {"id":"p1","type":"player","x":63,"y":75,"label":"1","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p2","type":"player","x":50,"y":60,"label":"2","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p3","type":"player","x":39,"y":75,"label":"3","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p4","type":"player","x":43,"y":75,"label":"4","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p5","type":"player","x":47,"y":75,"label":"5","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p6","type":"player","x":51,"y":75,"label":"6","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p7","type":"player","x":55,"y":75,"label":"7","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"b1","type":"ball","x":50,"y":60,"rotation":0,"size":1,"color":"#f5f5f5"}
    ]$JSON$::jsonb,
    $JSON$[
      {"id":"a2","type":"arrow-dashed","geometry":{"from":{"x":50,"y":40},"to":{"x":63,"y":75}},"style":{"color":"#a78bfa"}},
      {"id":"a3","type":"arrow-dashed","geometry":{"from":{"x":39,"y":75},"to":{"x":50,"y":60}},"style":{"color":"#a78bfa"}},
      {"id":"t2","type":"text","geometry":{"x":75,"y":78,"text":"Next up: 2"}}
    ]$JSON$::jsonb
  );

  ----------------------------------------------------------------------
  -- Frame 4 — Player 2 pushes forward.
  ----------------------------------------------------------------------
  INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
  VALUES (
    v_drill_id, 4, 1500,
    'Frame 4 — Player 2 pushes forward with their first touch.',
    $JSON$[
      {"id":"g1","type":"mini-goal","x":50,"y":12},
      {"id":"c1","type":"cone","x":50,"y":55,"rotation":0,"size":1,"color":"#f97316"},
      {"id":"p1","type":"player","x":63,"y":75,"label":"1","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p2","type":"player","x":50,"y":42,"label":"2","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p3","type":"player","x":39,"y":75,"label":"3","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p4","type":"player","x":43,"y":75,"label":"4","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p5","type":"player","x":47,"y":75,"label":"5","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p6","type":"player","x":51,"y":75,"label":"6","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p7","type":"player","x":55,"y":75,"label":"7","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"b1","type":"ball","x":50,"y":40,"rotation":0,"size":1,"color":"#f5f5f5"}
    ]$JSON$::jsonb,
    $JSON$[
      {"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":58},"to":{"x":50,"y":40}},"style":{"color":"#fbbf24"}}
    ]$JSON$::jsonb
  );

  ----------------------------------------------------------------------
  -- Frame 5 — Player 2 strikes.
  ----------------------------------------------------------------------
  INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
  VALUES (
    v_drill_id, 5, 1500,
    'Frame 5 — Player 2 strikes! Goal!',
    $JSON$[
      {"id":"g1","type":"mini-goal","x":50,"y":12},
      {"id":"c1","type":"cone","x":50,"y":55,"rotation":0,"size":1,"color":"#f97316"},
      {"id":"p1","type":"player","x":63,"y":75,"label":"1","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p2","type":"player","x":50,"y":40,"label":"2","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p3","type":"player","x":39,"y":75,"label":"3","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p4","type":"player","x":43,"y":75,"label":"4","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p5","type":"player","x":47,"y":75,"label":"5","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p6","type":"player","x":51,"y":75,"label":"6","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p7","type":"player","x":55,"y":75,"label":"7","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"b1","type":"ball","x":50,"y":12,"rotation":0,"size":1,"color":"#f5f5f5"}
    ]$JSON$::jsonb,
    $JSON$[
      {"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":38},"to":{"x":50,"y":14}},"style":{"color":"#22c55e"}},
      {"id":"t1","type":"text","geometry":{"x":65,"y":14,"text":"Goal!"}}
    ]$JSON$::jsonb
  );

  ----------------------------------------------------------------------
  -- Frame 6 — Rotate again. Player 2 jogs back, player 3 steps up,
  -- queue shuffles forward (now order at the line: 4,5,6,7,1,2 with 3 on ball).
  ----------------------------------------------------------------------
  INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
  VALUES (
    v_drill_id, 6, 1500,
    'Frame 6 — Rotate! Player 2 jogs back, player 3 steps onto the ball, line shuffles forward.',
    $JSON$[
      {"id":"g1","type":"mini-goal","x":50,"y":12},
      {"id":"c1","type":"cone","x":50,"y":55,"rotation":0,"size":1,"color":"#f97316"},
      {"id":"p1","type":"player","x":59,"y":75,"label":"1","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p2","type":"player","x":63,"y":75,"label":"2","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p3","type":"player","x":50,"y":60,"label":"3","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p4","type":"player","x":39,"y":75,"label":"4","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p5","type":"player","x":43,"y":75,"label":"5","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p6","type":"player","x":47,"y":75,"label":"6","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p7","type":"player","x":51,"y":75,"label":"7","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"b1","type":"ball","x":50,"y":60,"rotation":0,"size":1,"color":"#f5f5f5"}
    ]$JSON$::jsonb,
    $JSON$[
      {"id":"a2","type":"arrow-dashed","geometry":{"from":{"x":50,"y":40},"to":{"x":63,"y":75}},"style":{"color":"#a78bfa"}},
      {"id":"a3","type":"arrow-dashed","geometry":{"from":{"x":39,"y":75},"to":{"x":50,"y":60}},"style":{"color":"#a78bfa"}},
      {"id":"t2","type":"text","geometry":{"x":75,"y":78,"text":"Next up: 3"}}
    ]$JSON$::jsonb
  );

  ----------------------------------------------------------------------
  -- Frame 7 — Player 3 pushes forward.
  ----------------------------------------------------------------------
  INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
  VALUES (
    v_drill_id, 7, 1500,
    'Frame 7 — Player 3 pushes forward with their first touch.',
    $JSON$[
      {"id":"g1","type":"mini-goal","x":50,"y":12},
      {"id":"c1","type":"cone","x":50,"y":55,"rotation":0,"size":1,"color":"#f97316"},
      {"id":"p1","type":"player","x":59,"y":75,"label":"1","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p2","type":"player","x":63,"y":75,"label":"2","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p3","type":"player","x":50,"y":42,"label":"3","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p4","type":"player","x":39,"y":75,"label":"4","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p5","type":"player","x":43,"y":75,"label":"5","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p6","type":"player","x":47,"y":75,"label":"6","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p7","type":"player","x":51,"y":75,"label":"7","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"b1","type":"ball","x":50,"y":40,"rotation":0,"size":1,"color":"#f5f5f5"}
    ]$JSON$::jsonb,
    $JSON$[
      {"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":58},"to":{"x":50,"y":40}},"style":{"color":"#fbbf24"}}
    ]$JSON$::jsonb
  );

  ----------------------------------------------------------------------
  -- Frame 8 — Player 3 strikes; goal scored. Loop ends ready to repeat.
  ----------------------------------------------------------------------
  INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
  VALUES (
    v_drill_id, 8, 1500,
    'Frame 8 — Player 3 strikes! Goal! Loop continues — next rep is player 4.',
    $JSON$[
      {"id":"g1","type":"mini-goal","x":50,"y":12},
      {"id":"c1","type":"cone","x":50,"y":55,"rotation":0,"size":1,"color":"#f97316"},
      {"id":"p1","type":"player","x":59,"y":75,"label":"1","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p2","type":"player","x":63,"y":75,"label":"2","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p3","type":"player","x":50,"y":40,"label":"3","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p4","type":"player","x":39,"y":75,"label":"4","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p5","type":"player","x":43,"y":75,"label":"5","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p6","type":"player","x":47,"y":75,"label":"6","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p7","type":"player","x":51,"y":75,"label":"7","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"b1","type":"ball","x":50,"y":12,"rotation":0,"size":1,"color":"#f5f5f5"}
    ]$JSON$::jsonb,
    $JSON$[
      {"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":38},"to":{"x":50,"y":14}},"style":{"color":"#22c55e"}},
      {"id":"t1","type":"text","geometry":{"x":65,"y":14,"text":"Goal!"}},
      {"id":"t2","type":"text","geometry":{"x":75,"y":78,"text":"Next up: 4"}}
    ]$JSON$::jsonb
  );
END $$;