-- Rebuild the 5 frames of "Line shooting U6-U8" so the front queue
-- player performs the rep, then rotates to the back of the line on
-- the final frame while the rest of the queue shuffles forward.
--
-- Coordinates use the existing 0-100 % pitch convention.
-- Queue layout: y=75, x = 39, 43, 47, 51, 55, 59, 63 (slots 1..7).
-- Cone at (50,55), mini-goal at (50,12).

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

  -- Replace all frames for this drill with the rotation-aware version.
  DELETE FROM public.drill_frames WHERE drill_id = v_drill_id;

  -- Frame 0 — Setup. Player 1 has stepped to the cone with the ball.
  INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
  VALUES (
    v_drill_id, 0, 1500,
    'Setup — front player (1) on the ball at the cone, mini-goal 8m ahead. Rest of the line waits their turn.',
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

  -- Frame 1 — Player 1 pushes forward toward goal (first touch).
  INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
  VALUES (
    v_drill_id, 1, 1500,
    'Frame 1 — Player 1 pushes the ball forward with their first touch.',
    $JSON$[
      {"id":"g1","type":"mini-goal","x":50,"y":12},
      {"id":"c1","type":"cone","x":50,"y":55,"rotation":0,"size":1,"color":"#f97316"},
      {"id":"p1","type":"player","x":50,"y":52,"label":"1","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p2","type":"player","x":39,"y":75,"label":"2","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p3","type":"player","x":43,"y":75,"label":"3","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p4","type":"player","x":47,"y":75,"label":"4","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p5","type":"player","x":51,"y":75,"label":"5","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p6","type":"player","x":55,"y":75,"label":"6","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"p7","type":"player","x":59,"y":75,"label":"7","rotation":0,"size":1,"color":"#0ea5e9"},
      {"id":"b1","type":"ball","x":50,"y":48,"rotation":0,"size":1,"color":"#f5f5f5"}
    ]$JSON$::jsonb,
    $JSON$[
      {"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":60},"to":{"x":50,"y":48}},"style":{"color":"#fbbf24"}}
    ]$JSON$::jsonb
  );

  -- Frame 2 — Second touch sets up the strike.
  INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
  VALUES (
    v_drill_id, 2, 1500,
    'Frame 2 — Second touch sets the ball up nicely in front of player 1.',
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
      {"id":"b1","type":"ball","x":50,"y":38,"rotation":0,"size":1,"color":"#f5f5f5"}
    ]$JSON$::jsonb,
    $JSON$[
      {"id":"t1","type":"text","geometry":{"x":70,"y":42,"text":"Two touches then shoot"}}
    ]$JSON$::jsonb
  );

  -- Frame 3 — Plant foot, eyes on the ball, ready to strike.
  INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
  VALUES (
    v_drill_id, 3, 1500,
    'Frame 3 — Player 1 plants their non-kicking foot beside the ball, eyes down.',
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
      {"id":"b1","type":"ball","x":50,"y":38,"rotation":0,"size":1,"color":"#f5f5f5"}
    ]$JSON$::jsonb,
    $JSON$[
      {"id":"t1","type":"text","geometry":{"x":70,"y":40,"text":"Plant foot, eyes on ball"}}
    ]$JSON$::jsonb
  );

  -- Frame 4 — Strike + ROTATION. Ball into the goal, player 1 jogs to back of queue,
  -- players 2..7 shuffle forward one slot so player 2 is now on the ball.
  INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
  VALUES (
    v_drill_id, 4, 1500,
    'Frame 4 — Strike! Goal! Player 1 jogs to the back of the line, the queue shuffles forward and player 2 is now ready to go.',
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
      {"id":"b1","type":"ball","x":50,"y":12,"rotation":0,"size":1,"color":"#f5f5f5"}
    ]$JSON$::jsonb,
    $JSON$[
      {"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":36},"to":{"x":50,"y":14}},"style":{"color":"#22c55e"}},
      {"id":"a2","type":"arrow-dashed","geometry":{"from":{"x":50,"y":40},"to":{"x":63,"y":75}},"style":{"color":"#a78bfa"}},
      {"id":"a3","type":"arrow-dashed","geometry":{"from":{"x":39,"y":75},"to":{"x":50,"y":60}},"style":{"color":"#a78bfa"}},
      {"id":"t1","type":"text","geometry":{"x":65,"y":14,"text":"Goal!"}},
      {"id":"t2","type":"text","geometry":{"x":75,"y":78,"text":"Rotate — next up: 2"}}
    ]$JSON$::jsonb
  );
END $$;