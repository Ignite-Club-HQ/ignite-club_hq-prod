
-- =============================================================================
-- Pilot rebuild: 5 official drills updated with full-rotation animations.
-- Pattern: 9 frames showing 3 reps. Each rep = setup → action → rotate.
-- Both lines rotate where the drill has two queues.
-- =============================================================================

DO $$
DECLARE
  v_drill_id uuid;
BEGIN
  -- ============================================================================
  -- 1. DRIVEN SHOT FROM PASS U9-U12
  -- Layout: goal at top (y=12). Server cone at (30,55) feeds to shooter
  -- approaching from right line at (70,55). Shooter strikes, jogs to back
  -- of server line; server jogs to back of shooter line.
  -- Shooter queue (right): x=78, y=72/76/80/84
  -- Server queue (left):   x=22, y=72/76/80/84
  -- ============================================================================
  SELECT id INTO v_drill_id FROM public.drills
   WHERE name='Driven shot from pass U9-U12' AND is_official=true LIMIT 1;
  IF v_drill_id IS NOT NULL THEN
    DELETE FROM public.drill_frames WHERE drill_id = v_drill_id;

    -- Frame 0: setup
    INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
    (v_drill_id, 0, 1500, 'Setup — Server S1 on the ball, Shooter A1 ready on the right.',
     $J$[
       {"id":"g1","type":"goal","x":50,"y":12},
       {"id":"cs","type":"cone","x":30,"y":55,"color":"#f97316"},
       {"id":"ca","type":"cone","x":70,"y":55,"color":"#0ea5e9"},
       {"id":"s1","type":"player","x":30,"y":55,"label":"S1","color":"#f97316"},
       {"id":"s2","type":"player","x":22,"y":72,"label":"S2","color":"#f97316"},
       {"id":"s3","type":"player","x":22,"y":76,"label":"S3","color":"#f97316"},
       {"id":"s4","type":"player","x":22,"y":80,"label":"S4","color":"#f97316"},
       {"id":"a1","type":"player","x":70,"y":55,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":78,"y":72,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":78,"y":76,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":78,"y":80,"label":"A4","color":"#0ea5e9"},
       {"id":"b1","type":"ball","x":30,"y":55,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Server feeds → Shooter strikes → both rotate"}}]$J$::jsonb),

    -- Frame 1: S1 plays the firm pass to A1 angling in
    (v_drill_id, 1, 1500, 'S1 plays a firm pass to A1 angling in.',
     $J$[
       {"id":"g1","type":"goal","x":50,"y":12},
       {"id":"cs","type":"cone","x":30,"y":55,"color":"#f97316"},
       {"id":"ca","type":"cone","x":70,"y":55,"color":"#0ea5e9"},
       {"id":"s1","type":"player","x":30,"y":55,"label":"S1","color":"#f97316"},
       {"id":"s2","type":"player","x":22,"y":72,"label":"S2","color":"#f97316"},
       {"id":"s3","type":"player","x":22,"y":76,"label":"S3","color":"#f97316"},
       {"id":"s4","type":"player","x":22,"y":80,"label":"S4","color":"#f97316"},
       {"id":"a1","type":"player","x":58,"y":42,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":78,"y":72,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":78,"y":76,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":78,"y":80,"label":"A4","color":"#0ea5e9"},
       {"id":"b1","type":"ball","x":52,"y":42,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":33,"y":54},"to":{"x":52,"y":42}},"style":{"color":"#fbbf24"}}]$J$::jsonb),

    -- Frame 2: A1 strikes; ball flies into goal. Then both rotate.
    (v_drill_id, 2, 1500, 'A1 strikes — Goal! S1 jogs to back of A line, A1 jogs to back of S line.',
     $J$[
       {"id":"g1","type":"goal","x":50,"y":12},
       {"id":"cs","type":"cone","x":30,"y":55,"color":"#f97316"},
       {"id":"ca","type":"cone","x":70,"y":55,"color":"#0ea5e9"},
       {"id":"s1","type":"player","x":78,"y":84,"label":"S1","color":"#f97316"},
       {"id":"s2","type":"player","x":22,"y":72,"label":"S2","color":"#f97316"},
       {"id":"s3","type":"player","x":22,"y":76,"label":"S3","color":"#f97316"},
       {"id":"s4","type":"player","x":22,"y":80,"label":"S4","color":"#f97316"},
       {"id":"a1","type":"player","x":22,"y":84,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":78,"y":72,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":78,"y":76,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":78,"y":80,"label":"A4","color":"#0ea5e9"},
       {"id":"b1","type":"ball","x":50,"y":12,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[
       {"id":"sh","type":"arrow-solid","geometry":{"from":{"x":52,"y":40},"to":{"x":50,"y":14}},"style":{"color":"#22c55e"}},
       {"id":"goal","type":"text","geometry":{"x":65,"y":14,"text":"Goal!"}},
       {"id":"r1","type":"arrow-dashed","geometry":{"from":{"x":30,"y":55},"to":{"x":78,"y":84}},"style":{"color":"#a78bfa"}},
       {"id":"r2","type":"arrow-dashed","geometry":{"from":{"x":52,"y":40},"to":{"x":22,"y":84}},"style":{"color":"#a78bfa"}}
     ]$J$::jsonb),

    -- Frame 3: rep 2 setup — S2 on ball, A2 ready
    (v_drill_id, 3, 1500, 'Rep 2 setup — S2 steps onto the ball, A2 ready, queues shuffled forward.',
     $J$[
       {"id":"g1","type":"goal","x":50,"y":12},
       {"id":"cs","type":"cone","x":30,"y":55,"color":"#f97316"},
       {"id":"ca","type":"cone","x":70,"y":55,"color":"#0ea5e9"},
       {"id":"s1","type":"player","x":78,"y":84,"label":"S1","color":"#f97316"},
       {"id":"s2","type":"player","x":30,"y":55,"label":"S2","color":"#f97316"},
       {"id":"s3","type":"player","x":22,"y":72,"label":"S3","color":"#f97316"},
       {"id":"s4","type":"player","x":22,"y":76,"label":"S4","color":"#f97316"},
       {"id":"a1","type":"player","x":22,"y":84,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":70,"y":55,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":78,"y":72,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":78,"y":76,"label":"A4","color":"#0ea5e9"},
       {"id":"b1","type":"ball","x":30,"y":55,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Next pair — S2 + A2"}}]$J$::jsonb),

    -- Frame 4: pass
    (v_drill_id, 4, 1500, 'S2 plays the firm pass to A2.',
     $J$[
       {"id":"g1","type":"goal","x":50,"y":12},
       {"id":"cs","type":"cone","x":30,"y":55,"color":"#f97316"},
       {"id":"ca","type":"cone","x":70,"y":55,"color":"#0ea5e9"},
       {"id":"s1","type":"player","x":78,"y":84,"label":"S1","color":"#f97316"},
       {"id":"s2","type":"player","x":30,"y":55,"label":"S2","color":"#f97316"},
       {"id":"s3","type":"player","x":22,"y":72,"label":"S3","color":"#f97316"},
       {"id":"s4","type":"player","x":22,"y":76,"label":"S4","color":"#f97316"},
       {"id":"a1","type":"player","x":22,"y":84,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":58,"y":42,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":78,"y":72,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":78,"y":76,"label":"A4","color":"#0ea5e9"},
       {"id":"b1","type":"ball","x":52,"y":42,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":33,"y":54},"to":{"x":52,"y":42}},"style":{"color":"#fbbf24"}}]$J$::jsonb),

    -- Frame 5: A2 strikes + rotate
    (v_drill_id, 5, 1500, 'A2 strikes — Goal! Rotate again.',
     $J$[
       {"id":"g1","type":"goal","x":50,"y":12},
       {"id":"cs","type":"cone","x":30,"y":55,"color":"#f97316"},
       {"id":"ca","type":"cone","x":70,"y":55,"color":"#0ea5e9"},
       {"id":"s1","type":"player","x":78,"y":80,"label":"S1","color":"#f97316"},
       {"id":"s2","type":"player","x":78,"y":84,"label":"S2","color":"#f97316"},
       {"id":"s3","type":"player","x":22,"y":72,"label":"S3","color":"#f97316"},
       {"id":"s4","type":"player","x":22,"y":76,"label":"S4","color":"#f97316"},
       {"id":"a1","type":"player","x":22,"y":80,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":22,"y":84,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":78,"y":72,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":78,"y":76,"label":"A4","color":"#0ea5e9"},
       {"id":"b1","type":"ball","x":50,"y":12,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[
       {"id":"sh","type":"arrow-solid","geometry":{"from":{"x":52,"y":40},"to":{"x":50,"y":14}},"style":{"color":"#22c55e"}},
       {"id":"goal","type":"text","geometry":{"x":65,"y":14,"text":"Goal!"}}
     ]$J$::jsonb),

    -- Frame 6: rep 3 setup — S3 on ball, A3 ready
    (v_drill_id, 6, 1500, 'Rep 3 setup — S3 on the ball, A3 ready.',
     $J$[
       {"id":"g1","type":"goal","x":50,"y":12},
       {"id":"cs","type":"cone","x":30,"y":55,"color":"#f97316"},
       {"id":"ca","type":"cone","x":70,"y":55,"color":"#0ea5e9"},
       {"id":"s1","type":"player","x":78,"y":80,"label":"S1","color":"#f97316"},
       {"id":"s2","type":"player","x":78,"y":84,"label":"S2","color":"#f97316"},
       {"id":"s3","type":"player","x":30,"y":55,"label":"S3","color":"#f97316"},
       {"id":"s4","type":"player","x":22,"y":72,"label":"S4","color":"#f97316"},
       {"id":"a1","type":"player","x":22,"y":80,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":22,"y":84,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":70,"y":55,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":78,"y":72,"label":"A4","color":"#0ea5e9"},
       {"id":"b1","type":"ball","x":30,"y":55,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"t1","type":"text","geometry":{"x":50,"y":92,"text":"Next pair — S3 + A3"}}]$J$::jsonb),

    -- Frame 7: pass
    (v_drill_id, 7, 1500, 'S3 feeds A3.',
     $J$[
       {"id":"g1","type":"goal","x":50,"y":12},
       {"id":"cs","type":"cone","x":30,"y":55,"color":"#f97316"},
       {"id":"ca","type":"cone","x":70,"y":55,"color":"#0ea5e9"},
       {"id":"s1","type":"player","x":78,"y":80,"label":"S1","color":"#f97316"},
       {"id":"s2","type":"player","x":78,"y":84,"label":"S2","color":"#f97316"},
       {"id":"s3","type":"player","x":30,"y":55,"label":"S3","color":"#f97316"},
       {"id":"s4","type":"player","x":22,"y":72,"label":"S4","color":"#f97316"},
       {"id":"a1","type":"player","x":22,"y":80,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":22,"y":84,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":58,"y":42,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":78,"y":72,"label":"A4","color":"#0ea5e9"},
       {"id":"b1","type":"ball","x":52,"y":42,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":33,"y":54},"to":{"x":52,"y":42}},"style":{"color":"#fbbf24"}}]$J$::jsonb),

    -- Frame 8: A3 strikes; loop ends
    (v_drill_id, 8, 1500, 'A3 strikes — Goal! Loop continues with S4 / A4.',
     $J$[
       {"id":"g1","type":"goal","x":50,"y":12},
       {"id":"cs","type":"cone","x":30,"y":55,"color":"#f97316"},
       {"id":"ca","type":"cone","x":70,"y":55,"color":"#0ea5e9"},
       {"id":"s1","type":"player","x":78,"y":76,"label":"S1","color":"#f97316"},
       {"id":"s2","type":"player","x":78,"y":80,"label":"S2","color":"#f97316"},
       {"id":"s3","type":"player","x":78,"y":84,"label":"S3","color":"#f97316"},
       {"id":"s4","type":"player","x":22,"y":72,"label":"S4","color":"#f97316"},
       {"id":"a1","type":"player","x":22,"y":76,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":22,"y":80,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":22,"y":84,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":78,"y":72,"label":"A4","color":"#0ea5e9"},
       {"id":"b1","type":"ball","x":50,"y":12,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[
       {"id":"sh","type":"arrow-solid","geometry":{"from":{"x":52,"y":40},"to":{"x":50,"y":14}},"style":{"color":"#22c55e"}},
       {"id":"goal","type":"text","geometry":{"x":65,"y":14,"text":"Goal!"}},
       {"id":"t","type":"text","geometry":{"x":50,"y":92,"text":"Next pair: S4 / A4"}}
     ]$J$::jsonb);
  END IF;

  -- ============================================================================
  -- 2. CONE SLALOM DRIBBLE — single line.
  -- 5 cones in a vertical line at x=50, y=22,32,42,52,62.
  -- Start cone at (50,72). Queue at y=80,84,88 (x=42,46,50,54,58,62).
  -- Player slaloms up, jogs around outside back to back of line.
  -- ============================================================================
  SELECT id INTO v_drill_id FROM public.drills
   WHERE name='Cone slalom dribble' AND is_official=true LIMIT 1;
  IF v_drill_id IS NOT NULL THEN
    DELETE FROM public.drill_frames WHERE drill_id = v_drill_id;

    INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
    -- Frame 0: setup
    (v_drill_id, 0, 1400, 'Setup — Player 1 on the ball at the start cone, queue (2..7) waiting.',
     $J$[
       {"id":"c1","type":"cone","x":50,"y":22,"color":"#f97316"},
       {"id":"c2","type":"cone","x":50,"y":32,"color":"#f97316"},
       {"id":"c3","type":"cone","x":50,"y":42,"color":"#f97316"},
       {"id":"c4","type":"cone","x":50,"y":52,"color":"#f97316"},
       {"id":"c5","type":"cone","x":50,"y":62,"color":"#f97316"},
       {"id":"cs","type":"cone","x":50,"y":72,"color":"#22c55e"},
       {"id":"p1","type":"player","x":50,"y":72,"label":"1","color":"#0ea5e9"},
       {"id":"p2","type":"player","x":42,"y":80,"label":"2","color":"#0ea5e9"},
       {"id":"p3","type":"player","x":46,"y":80,"label":"3","color":"#0ea5e9"},
       {"id":"p4","type":"player","x":50,"y":80,"label":"4","color":"#0ea5e9"},
       {"id":"p5","type":"player","x":54,"y":80,"label":"5","color":"#0ea5e9"},
       {"id":"p6","type":"player","x":58,"y":80,"label":"6","color":"#0ea5e9"},
       {"id":"p7","type":"player","x":62,"y":80,"label":"7","color":"#0ea5e9"},
       {"id":"b1","type":"ball","x":50,"y":72,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"t","type":"text","geometry":{"x":50,"y":92,"text":"Slalom up · jog back outside the cones"}}]$J$::jsonb),

    -- Frame 1: P1 weaves halfway up
    (v_drill_id, 1, 1400, 'P1 weaves through the lower cones.',
     $J$[
       {"id":"c1","type":"cone","x":50,"y":22,"color":"#f97316"},
       {"id":"c2","type":"cone","x":50,"y":32,"color":"#f97316"},
       {"id":"c3","type":"cone","x":50,"y":42,"color":"#f97316"},
       {"id":"c4","type":"cone","x":50,"y":52,"color":"#f97316"},
       {"id":"c5","type":"cone","x":50,"y":62,"color":"#f97316"},
       {"id":"cs","type":"cone","x":50,"y":72,"color":"#22c55e"},
       {"id":"p1","type":"player","x":54,"y":47,"label":"1","color":"#0ea5e9"},
       {"id":"p2","type":"player","x":42,"y":80,"label":"2","color":"#0ea5e9"},
       {"id":"p3","type":"player","x":46,"y":80,"label":"3","color":"#0ea5e9"},
       {"id":"p4","type":"player","x":50,"y":80,"label":"4","color":"#0ea5e9"},
       {"id":"p5","type":"player","x":54,"y":80,"label":"5","color":"#0ea5e9"},
       {"id":"p6","type":"player","x":58,"y":80,"label":"6","color":"#0ea5e9"},
       {"id":"p7","type":"player","x":62,"y":80,"label":"7","color":"#0ea5e9"},
       {"id":"b1","type":"ball","x":54,"y":47,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":70},"to":{"x":54,"y":47}},"style":{"color":"#fbbf24"}}]$J$::jsonb),

    -- Frame 2: P1 finished slalom + jogged around to back of line
    (v_drill_id, 2, 1500, 'P1 clears the top cone then jogs back outside to the end of the queue.',
     $J$[
       {"id":"c1","type":"cone","x":50,"y":22,"color":"#f97316"},
       {"id":"c2","type":"cone","x":50,"y":32,"color":"#f97316"},
       {"id":"c3","type":"cone","x":50,"y":42,"color":"#f97316"},
       {"id":"c4","type":"cone","x":50,"y":52,"color":"#f97316"},
       {"id":"c5","type":"cone","x":50,"y":62,"color":"#f97316"},
       {"id":"cs","type":"cone","x":50,"y":72,"color":"#22c55e"},
       {"id":"p1","type":"player","x":62,"y":80,"label":"1","color":"#0ea5e9"},
       {"id":"p2","type":"player","x":50,"y":72,"label":"2","color":"#0ea5e9"},
       {"id":"p3","type":"player","x":42,"y":80,"label":"3","color":"#0ea5e9"},
       {"id":"p4","type":"player","x":46,"y":80,"label":"4","color":"#0ea5e9"},
       {"id":"p5","type":"player","x":50,"y":80,"label":"5","color":"#0ea5e9"},
       {"id":"p6","type":"player","x":54,"y":80,"label":"6","color":"#0ea5e9"},
       {"id":"p7","type":"player","x":58,"y":80,"label":"7","color":"#0ea5e9"},
       {"id":"b1","type":"ball","x":50,"y":72,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[
       {"id":"r1","type":"arrow-dashed","geometry":{"from":{"x":50,"y":18},"to":{"x":62,"y":80}},"style":{"color":"#a78bfa"}},
       {"id":"r2","type":"arrow-dashed","geometry":{"from":{"x":42,"y":80},"to":{"x":50,"y":72}},"style":{"color":"#a78bfa"}}
     ]$J$::jsonb),

    -- Frames 3-5: rep 2 (P2 slaloms)
    (v_drill_id, 3, 1400, 'P2 weaves through the cones.',
     $J$[
       {"id":"c1","type":"cone","x":50,"y":22,"color":"#f97316"},
       {"id":"c2","type":"cone","x":50,"y":32,"color":"#f97316"},
       {"id":"c3","type":"cone","x":50,"y":42,"color":"#f97316"},
       {"id":"c4","type":"cone","x":50,"y":52,"color":"#f97316"},
       {"id":"c5","type":"cone","x":50,"y":62,"color":"#f97316"},
       {"id":"cs","type":"cone","x":50,"y":72,"color":"#22c55e"},
       {"id":"p1","type":"player","x":62,"y":80,"label":"1","color":"#0ea5e9"},
       {"id":"p2","type":"player","x":54,"y":47,"label":"2","color":"#0ea5e9"},
       {"id":"p3","type":"player","x":42,"y":80,"label":"3","color":"#0ea5e9"},
       {"id":"p4","type":"player","x":46,"y":80,"label":"4","color":"#0ea5e9"},
       {"id":"p5","type":"player","x":50,"y":80,"label":"5","color":"#0ea5e9"},
       {"id":"p6","type":"player","x":54,"y":80,"label":"6","color":"#0ea5e9"},
       {"id":"p7","type":"player","x":58,"y":80,"label":"7","color":"#0ea5e9"},
       {"id":"b1","type":"ball","x":54,"y":47,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":70},"to":{"x":54,"y":47}},"style":{"color":"#fbbf24"}}]$J$::jsonb),

    (v_drill_id, 4, 1500, 'P2 clears the cones, jogs back; P3 ready on the ball.',
     $J$[
       {"id":"c1","type":"cone","x":50,"y":22,"color":"#f97316"},
       {"id":"c2","type":"cone","x":50,"y":32,"color":"#f97316"},
       {"id":"c3","type":"cone","x":50,"y":42,"color":"#f97316"},
       {"id":"c4","type":"cone","x":50,"y":52,"color":"#f97316"},
       {"id":"c5","type":"cone","x":50,"y":62,"color":"#f97316"},
       {"id":"cs","type":"cone","x":50,"y":72,"color":"#22c55e"},
       {"id":"p1","type":"player","x":58,"y":80,"label":"1","color":"#0ea5e9"},
       {"id":"p2","type":"player","x":62,"y":80,"label":"2","color":"#0ea5e9"},
       {"id":"p3","type":"player","x":50,"y":72,"label":"3","color":"#0ea5e9"},
       {"id":"p4","type":"player","x":42,"y":80,"label":"4","color":"#0ea5e9"},
       {"id":"p5","type":"player","x":46,"y":80,"label":"5","color":"#0ea5e9"},
       {"id":"p6","type":"player","x":50,"y":80,"label":"6","color":"#0ea5e9"},
       {"id":"p7","type":"player","x":54,"y":80,"label":"7","color":"#0ea5e9"},
       {"id":"b1","type":"ball","x":50,"y":72,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"t","type":"text","geometry":{"x":50,"y":92,"text":"Next up: 3"}}]$J$::jsonb),

    -- Rep 3
    (v_drill_id, 5, 1400, 'P3 weaves through the cones.',
     $J$[
       {"id":"c1","type":"cone","x":50,"y":22,"color":"#f97316"},
       {"id":"c2","type":"cone","x":50,"y":32,"color":"#f97316"},
       {"id":"c3","type":"cone","x":50,"y":42,"color":"#f97316"},
       {"id":"c4","type":"cone","x":50,"y":52,"color":"#f97316"},
       {"id":"c5","type":"cone","x":50,"y":62,"color":"#f97316"},
       {"id":"cs","type":"cone","x":50,"y":72,"color":"#22c55e"},
       {"id":"p1","type":"player","x":58,"y":80,"label":"1","color":"#0ea5e9"},
       {"id":"p2","type":"player","x":62,"y":80,"label":"2","color":"#0ea5e9"},
       {"id":"p3","type":"player","x":54,"y":47,"label":"3","color":"#0ea5e9"},
       {"id":"p4","type":"player","x":42,"y":80,"label":"4","color":"#0ea5e9"},
       {"id":"p5","type":"player","x":46,"y":80,"label":"5","color":"#0ea5e9"},
       {"id":"p6","type":"player","x":50,"y":80,"label":"6","color":"#0ea5e9"},
       {"id":"p7","type":"player","x":54,"y":80,"label":"7","color":"#0ea5e9"},
       {"id":"b1","type":"ball","x":54,"y":47,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":70},"to":{"x":54,"y":47}},"style":{"color":"#fbbf24"}}]$J$::jsonb),

    (v_drill_id, 6, 1500, 'P3 jogs back outside; P4 steps on the ball next.',
     $J$[
       {"id":"c1","type":"cone","x":50,"y":22,"color":"#f97316"},
       {"id":"c2","type":"cone","x":50,"y":32,"color":"#f97316"},
       {"id":"c3","type":"cone","x":50,"y":42,"color":"#f97316"},
       {"id":"c4","type":"cone","x":50,"y":52,"color":"#f97316"},
       {"id":"c5","type":"cone","x":50,"y":62,"color":"#f97316"},
       {"id":"cs","type":"cone","x":50,"y":72,"color":"#22c55e"},
       {"id":"p1","type":"player","x":54,"y":80,"label":"1","color":"#0ea5e9"},
       {"id":"p2","type":"player","x":58,"y":80,"label":"2","color":"#0ea5e9"},
       {"id":"p3","type":"player","x":62,"y":80,"label":"3","color":"#0ea5e9"},
       {"id":"p4","type":"player","x":50,"y":72,"label":"4","color":"#0ea5e9"},
       {"id":"p5","type":"player","x":42,"y":80,"label":"5","color":"#0ea5e9"},
       {"id":"p6","type":"player","x":46,"y":80,"label":"6","color":"#0ea5e9"},
       {"id":"p7","type":"player","x":50,"y":80,"label":"7","color":"#0ea5e9"},
       {"id":"b1","type":"ball","x":50,"y":72,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"t","type":"text","geometry":{"x":50,"y":92,"text":"Next up: 4"}}]$J$::jsonb);
  END IF;

  -- ============================================================================
  -- 3. PASSING SQUARES — pass-and-follow around a square.
  -- 4 corner cones at (30,30),(70,30),(70,70),(30,70). Players at each corner;
  -- pass to next clockwise corner then jog to back of that line.
  -- 8 players, 2 per corner queue.
  -- ============================================================================
  SELECT id INTO v_drill_id FROM public.drills
   WHERE name='Passing squares' AND is_official=true LIMIT 1;
  IF v_drill_id IS NOT NULL THEN
    DELETE FROM public.drill_frames WHERE drill_id = v_drill_id;

    INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
    -- Frame 0: setup. Front player at each cone, second player just behind.
    (v_drill_id, 0, 1400, 'Setup — one player at each corner cone, partner behind. Pass clockwise then follow.',
     $J$[
       {"id":"cTL","type":"cone","x":30,"y":30,"color":"#f97316"},
       {"id":"cTR","type":"cone","x":70,"y":30,"color":"#f97316"},
       {"id":"cBR","type":"cone","x":70,"y":70,"color":"#f97316"},
       {"id":"cBL","type":"cone","x":30,"y":70,"color":"#f97316"},
       {"id":"a1","type":"player","x":30,"y":30,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":24,"y":24,"label":"A2","color":"#0ea5e9"},
       {"id":"b1","type":"player","x":70,"y":30,"label":"B1","color":"#22c55e"},
       {"id":"b2","type":"player","x":76,"y":24,"label":"B2","color":"#22c55e"},
       {"id":"c1","type":"player","x":70,"y":70,"label":"C1","color":"#fbbf24"},
       {"id":"c2","type":"player","x":76,"y":76,"label":"C2","color":"#fbbf24"},
       {"id":"d1","type":"player","x":30,"y":70,"label":"D1","color":"#a78bfa"},
       {"id":"d2","type":"player","x":24,"y":76,"label":"D2","color":"#a78bfa"},
       {"id":"ball","type":"ball","x":30,"y":30,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"t","type":"text","geometry":{"x":50,"y":92,"text":"Pass clockwise → follow your pass"}}]$J$::jsonb),

    -- Frame 1: A1 passes to B1
    (v_drill_id, 1, 1300, 'A1 passes to B1.',
     $J$[
       {"id":"cTL","type":"cone","x":30,"y":30,"color":"#f97316"},
       {"id":"cTR","type":"cone","x":70,"y":30,"color":"#f97316"},
       {"id":"cBR","type":"cone","x":70,"y":70,"color":"#f97316"},
       {"id":"cBL","type":"cone","x":30,"y":70,"color":"#f97316"},
       {"id":"a1","type":"player","x":30,"y":30,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":24,"y":24,"label":"A2","color":"#0ea5e9"},
       {"id":"b1","type":"player","x":70,"y":30,"label":"B1","color":"#22c55e"},
       {"id":"b2","type":"player","x":76,"y":24,"label":"B2","color":"#22c55e"},
       {"id":"c1","type":"player","x":70,"y":70,"label":"C1","color":"#fbbf24"},
       {"id":"c2","type":"player","x":76,"y":76,"label":"C2","color":"#fbbf24"},
       {"id":"d1","type":"player","x":30,"y":70,"label":"D1","color":"#a78bfa"},
       {"id":"d2","type":"player","x":24,"y":76,"label":"D2","color":"#a78bfa"},
       {"id":"ball","type":"ball","x":68,"y":30,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":33,"y":30},"to":{"x":68,"y":30}},"style":{"color":"#fbbf24"}}]$J$::jsonb),

    -- Frame 2: A1 follows pass to B-line back; B-queue shuffles; B1 about to pass to C1
    (v_drill_id, 2, 1500, 'A1 follows pass to back of B line. B1 plays to C1.',
     $J$[
       {"id":"cTL","type":"cone","x":30,"y":30,"color":"#f97316"},
       {"id":"cTR","type":"cone","x":70,"y":30,"color":"#f97316"},
       {"id":"cBR","type":"cone","x":70,"y":70,"color":"#f97316"},
       {"id":"cBL","type":"cone","x":30,"y":70,"color":"#f97316"},
       {"id":"a1","type":"player","x":76,"y":24,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":30,"y":30,"label":"A2","color":"#0ea5e9"},
       {"id":"b1","type":"player","x":70,"y":30,"label":"B1","color":"#22c55e"},
       {"id":"b2","type":"player","x":24,"y":24,"label":"B2","color":"#22c55e"},
       {"id":"c1","type":"player","x":70,"y":70,"label":"C1","color":"#fbbf24"},
       {"id":"c2","type":"player","x":76,"y":76,"label":"C2","color":"#fbbf24"},
       {"id":"d1","type":"player","x":30,"y":70,"label":"D1","color":"#a78bfa"},
       {"id":"d2","type":"player","x":24,"y":76,"label":"D2","color":"#a78bfa"},
       {"id":"ball","type":"ball","x":70,"y":68,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[
       {"id":"r1","type":"arrow-dashed","geometry":{"from":{"x":30,"y":30},"to":{"x":76,"y":24}},"style":{"color":"#a78bfa"}},
       {"id":"a1","type":"arrow-solid","geometry":{"from":{"x":70,"y":33},"to":{"x":70,"y":68}},"style":{"color":"#fbbf24"}}
     ]$J$::jsonb),

    -- Frame 3: B1 follows to C; C1 plays to D1
    (v_drill_id, 3, 1500, 'B1 follows pass to back of C line. C1 plays to D1.',
     $J$[
       {"id":"cTL","type":"cone","x":30,"y":30,"color":"#f97316"},
       {"id":"cTR","type":"cone","x":70,"y":30,"color":"#f97316"},
       {"id":"cBR","type":"cone","x":70,"y":70,"color":"#f97316"},
       {"id":"cBL","type":"cone","x":30,"y":70,"color":"#f97316"},
       {"id":"a1","type":"player","x":76,"y":24,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":30,"y":30,"label":"A2","color":"#0ea5e9"},
       {"id":"b1","type":"player","x":76,"y":76,"label":"B1","color":"#22c55e"},
       {"id":"b2","type":"player","x":24,"y":24,"label":"B2","color":"#22c55e"},
       {"id":"c1","type":"player","x":70,"y":70,"label":"C1","color":"#fbbf24"},
       {"id":"c2","type":"player","x":70,"y":30,"label":"C2","color":"#fbbf24"},
       {"id":"d1","type":"player","x":30,"y":70,"label":"D1","color":"#a78bfa"},
       {"id":"d2","type":"player","x":24,"y":76,"label":"D2","color":"#a78bfa"},
       {"id":"ball","type":"ball","x":32,"y":70,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[
       {"id":"r1","type":"arrow-dashed","geometry":{"from":{"x":70,"y":30},"to":{"x":76,"y":76}},"style":{"color":"#a78bfa"}},
       {"id":"a1","type":"arrow-solid","geometry":{"from":{"x":67,"y":70},"to":{"x":32,"y":70}},"style":{"color":"#fbbf24"}}
     ]$J$::jsonb),

    -- Frame 4: C1 follows; D1 plays back to A-corner (now A2 in the slot)
    (v_drill_id, 4, 1500, 'C1 follows to back of D line. D1 plays to A2 to complete the lap.',
     $J$[
       {"id":"cTL","type":"cone","x":30,"y":30,"color":"#f97316"},
       {"id":"cTR","type":"cone","x":70,"y":30,"color":"#f97316"},
       {"id":"cBR","type":"cone","x":70,"y":70,"color":"#f97316"},
       {"id":"cBL","type":"cone","x":30,"y":70,"color":"#f97316"},
       {"id":"a1","type":"player","x":76,"y":24,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":30,"y":30,"label":"A2","color":"#0ea5e9"},
       {"id":"b1","type":"player","x":76,"y":76,"label":"B1","color":"#22c55e"},
       {"id":"b2","type":"player","x":24,"y":24,"label":"B2","color":"#22c55e"},
       {"id":"c1","type":"player","x":24,"y":76,"label":"C1","color":"#fbbf24"},
       {"id":"c2","type":"player","x":70,"y":30,"label":"C2","color":"#fbbf24"},
       {"id":"d1","type":"player","x":30,"y":70,"label":"D1","color":"#a78bfa"},
       {"id":"d2","type":"player","x":30,"y":30,"label":"D2","color":"#a78bfa"},
       {"id":"ball","type":"ball","x":30,"y":32,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[
       {"id":"r1","type":"arrow-dashed","geometry":{"from":{"x":70,"y":70},"to":{"x":24,"y":76}},"style":{"color":"#a78bfa"}},
       {"id":"a1","type":"arrow-solid","geometry":{"from":{"x":30,"y":67},"to":{"x":30,"y":32}},"style":{"color":"#fbbf24"}}
     ]$J$::jsonb),

    -- Frame 5: D1 follows to back of A line. New cycle ready.
    (v_drill_id, 5, 1500, 'D1 follows to back of A line. Lap complete — A2 starts the next.',
     $J$[
       {"id":"cTL","type":"cone","x":30,"y":30,"color":"#f97316"},
       {"id":"cTR","type":"cone","x":70,"y":30,"color":"#f97316"},
       {"id":"cBR","type":"cone","x":70,"y":70,"color":"#f97316"},
       {"id":"cBL","type":"cone","x":30,"y":70,"color":"#f97316"},
       {"id":"a1","type":"player","x":76,"y":24,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":30,"y":30,"label":"A2","color":"#0ea5e9"},
       {"id":"b1","type":"player","x":76,"y":76,"label":"B1","color":"#22c55e"},
       {"id":"b2","type":"player","x":24,"y":24,"label":"B2","color":"#22c55e"},
       {"id":"c1","type":"player","x":24,"y":76,"label":"C1","color":"#fbbf24"},
       {"id":"c2","type":"player","x":70,"y":30,"label":"C2","color":"#fbbf24"},
       {"id":"d1","type":"player","x":24,"y":24,"label":"D1","color":"#a78bfa"},
       {"id":"d2","type":"player","x":30,"y":30,"label":"D2","color":"#a78bfa"},
       {"id":"ball","type":"ball","x":30,"y":30,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[
       {"id":"r1","type":"arrow-dashed","geometry":{"from":{"x":30,"y":70},"to":{"x":24,"y":24}},"style":{"color":"#a78bfa"}},
       {"id":"t","type":"text","geometry":{"x":50,"y":92,"text":"Lap 1 done — A2 starts lap 2"}}
     ]$J$::jsonb),

    -- Frame 6: lap 2 — A2 passes to B2 (now B-front)
    (v_drill_id, 6, 1300, 'Lap 2 — A2 plays B2.',
     $J$[
       {"id":"cTL","type":"cone","x":30,"y":30,"color":"#f97316"},
       {"id":"cTR","type":"cone","x":70,"y":30,"color":"#f97316"},
       {"id":"cBR","type":"cone","x":70,"y":70,"color":"#f97316"},
       {"id":"cBL","type":"cone","x":30,"y":70,"color":"#f97316"},
       {"id":"a1","type":"player","x":76,"y":24,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":30,"y":30,"label":"A2","color":"#0ea5e9"},
       {"id":"b1","type":"player","x":76,"y":76,"label":"B1","color":"#22c55e"},
       {"id":"b2","type":"player","x":70,"y":30,"label":"B2","color":"#22c55e"},
       {"id":"c1","type":"player","x":24,"y":76,"label":"C1","color":"#fbbf24"},
       {"id":"c2","type":"player","x":70,"y":30,"label":"C2","color":"#fbbf24"},
       {"id":"d1","type":"player","x":24,"y":24,"label":"D1","color":"#a78bfa"},
       {"id":"d2","type":"player","x":30,"y":30,"label":"D2","color":"#a78bfa"},
       {"id":"ball","type":"ball","x":68,"y":30,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":33,"y":30},"to":{"x":68,"y":30}},"style":{"color":"#fbbf24"}}]$J$::jsonb),

    -- Frame 7: B2 plays C2 (mid lap)
    (v_drill_id, 7, 1300, 'B2 plays C2.',
     $J$[
       {"id":"cTL","type":"cone","x":30,"y":30,"color":"#f97316"},
       {"id":"cTR","type":"cone","x":70,"y":30,"color":"#f97316"},
       {"id":"cBR","type":"cone","x":70,"y":70,"color":"#f97316"},
       {"id":"cBL","type":"cone","x":30,"y":70,"color":"#f97316"},
       {"id":"a1","type":"player","x":76,"y":24,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":24,"y":24,"label":"A2","color":"#0ea5e9"},
       {"id":"b1","type":"player","x":76,"y":76,"label":"B1","color":"#22c55e"},
       {"id":"b2","type":"player","x":70,"y":30,"label":"B2","color":"#22c55e"},
       {"id":"c1","type":"player","x":24,"y":76,"label":"C1","color":"#fbbf24"},
       {"id":"c2","type":"player","x":70,"y":70,"label":"C2","color":"#fbbf24"},
       {"id":"d1","type":"player","x":24,"y":24,"label":"D1","color":"#a78bfa"},
       {"id":"d2","type":"player","x":30,"y":30,"label":"D2","color":"#a78bfa"},
       {"id":"ball","type":"ball","x":70,"y":68,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[
       {"id":"r1","type":"arrow-dashed","geometry":{"from":{"x":30,"y":30},"to":{"x":24,"y":24}},"style":{"color":"#a78bfa"}},
       {"id":"a1","type":"arrow-solid","geometry":{"from":{"x":70,"y":33},"to":{"x":70,"y":68}},"style":{"color":"#fbbf24"}}
     ]$J$::jsonb),

    -- Frame 8: cycle continues
    (v_drill_id, 8, 1500, 'Lap continues — pattern keeps rotating both lines through every corner.',
     $J$[
       {"id":"cTL","type":"cone","x":30,"y":30,"color":"#f97316"},
       {"id":"cTR","type":"cone","x":70,"y":30,"color":"#f97316"},
       {"id":"cBR","type":"cone","x":70,"y":70,"color":"#f97316"},
       {"id":"cBL","type":"cone","x":30,"y":70,"color":"#f97316"},
       {"id":"a1","type":"player","x":76,"y":24,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":24,"y":24,"label":"A2","color":"#0ea5e9"},
       {"id":"b1","type":"player","x":76,"y":76,"label":"B1","color":"#22c55e"},
       {"id":"b2","type":"player","x":76,"y":76,"label":"B2","color":"#22c55e"},
       {"id":"c1","type":"player","x":24,"y":76,"label":"C1","color":"#fbbf24"},
       {"id":"c2","type":"player","x":70,"y":70,"label":"C2","color":"#fbbf24"},
       {"id":"d1","type":"player","x":24,"y":24,"label":"D1","color":"#a78bfa"},
       {"id":"d2","type":"player","x":30,"y":70,"label":"D2","color":"#a78bfa"},
       {"id":"ball","type":"ball","x":32,"y":70,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[
       {"id":"r1","type":"arrow-dashed","geometry":{"from":{"x":70,"y":30},"to":{"x":76,"y":76}},"style":{"color":"#a78bfa"}},
       {"id":"a1","type":"arrow-solid","geometry":{"from":{"x":67,"y":70},"to":{"x":32,"y":70}},"style":{"color":"#fbbf24"}},
       {"id":"t","type":"text","geometry":{"x":50,"y":92,"text":"Pass · Follow · Repeat"}}
     ]$J$::jsonb);
  END IF;

  -- ============================================================================
  -- 4. 1v1 TO MINI-GOALS — two queues swap (attacker→def line, def→att line).
  -- Mini-goals top (50,10) and bottom (50,90).
  -- Attacker line (blue) parked top-left at x=20-26, y=18-26 (front A1 at 50,40).
  -- Defender line (red) parked bottom-right at x=74-80, y=74-82 (front D1 at 50,60).
  -- After each duel: attacker jogs to back of defender line, defender to back of
  -- attacker line, next pair steps in.
  -- ============================================================================
  SELECT id INTO v_drill_id FROM public.drills
   WHERE name='1v1 to mini-goals' AND is_official=true LIMIT 1;
  IF v_drill_id IS NOT NULL THEN
    DELETE FROM public.drill_frames WHERE drill_id = v_drill_id;

    INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
    -- Frame 0: setup
    (v_drill_id, 0, 1500, 'Setup — Attacker A1 on the ball, Defender D1 facing up. Queues wait at the corners.',
     $J$[
       {"id":"g1","type":"mini-goal","x":50,"y":10},
       {"id":"g2","type":"mini-goal","x":50,"y":90},
       {"id":"a1","type":"player","x":50,"y":50,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":18,"y":18,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":18,"y":24,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":18,"y":30,"label":"A4","color":"#0ea5e9"},
       {"id":"d1","type":"player","x":50,"y":42,"label":"D1","color":"#ef4444"},
       {"id":"d2","type":"player","x":82,"y":76,"label":"D2","color":"#ef4444"},
       {"id":"d3","type":"player","x":82,"y":82,"label":"D3","color":"#ef4444"},
       {"id":"d4","type":"player","x":82,"y":88,"label":"D4","color":"#ef4444"},
       {"id":"b1","type":"ball","x":50,"y":52,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"t","type":"text","geometry":{"x":50,"y":95,"text":"After each duel: A → D line, D → A line"}}]$J$::jsonb),

    -- Frame 1: A1 attacks, beats D1, scores in top mini-goal
    (v_drill_id, 1, 1500, 'A1 takes on D1, drives forward.',
     $J$[
       {"id":"g1","type":"mini-goal","x":50,"y":10},
       {"id":"g2","type":"mini-goal","x":50,"y":90},
       {"id":"a1","type":"player","x":42,"y":30,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":18,"y":18,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":18,"y":24,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":18,"y":30,"label":"A4","color":"#0ea5e9"},
       {"id":"d1","type":"player","x":52,"y":36,"label":"D1","color":"#ef4444"},
       {"id":"d2","type":"player","x":82,"y":76,"label":"D2","color":"#ef4444"},
       {"id":"d3","type":"player","x":82,"y":82,"label":"D3","color":"#ef4444"},
       {"id":"d4","type":"player","x":82,"y":88,"label":"D4","color":"#ef4444"},
       {"id":"b1","type":"ball","x":40,"y":30,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":50},"to":{"x":40,"y":30}},"style":{"color":"#fbbf24"}}]$J$::jsonb),

    -- Frame 2: A1 finishes; then both rotate to opposite lines
    (v_drill_id, 2, 1600, 'A1 finishes — Goal! A1 jogs to back of D line, D1 jogs to back of A line.',
     $J$[
       {"id":"g1","type":"mini-goal","x":50,"y":10},
       {"id":"g2","type":"mini-goal","x":50,"y":90},
       {"id":"a1","type":"player","x":82,"y":88,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":18,"y":18,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":18,"y":24,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":18,"y":30,"label":"A4","color":"#0ea5e9"},
       {"id":"d1","type":"player","x":18,"y":36,"label":"D1","color":"#ef4444"},
       {"id":"d2","type":"player","x":82,"y":76,"label":"D2","color":"#ef4444"},
       {"id":"d3","type":"player","x":82,"y":82,"label":"D3","color":"#ef4444"},
       {"id":"d4","type":"player","x":82,"y":88,"label":"D4","color":"#ef4444"},
       {"id":"b1","type":"ball","x":50,"y":10,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[
       {"id":"sh","type":"arrow-solid","geometry":{"from":{"x":40,"y":28},"to":{"x":50,"y":12}},"style":{"color":"#22c55e"}},
       {"id":"goal","type":"text","geometry":{"x":65,"y":12,"text":"Goal!"}},
       {"id":"r1","type":"arrow-dashed","geometry":{"from":{"x":42,"y":28},"to":{"x":82,"y":88}},"style":{"color":"#a78bfa"}},
       {"id":"r2","type":"arrow-dashed","geometry":{"from":{"x":52,"y":36},"to":{"x":18,"y":36}},"style":{"color":"#a78bfa"}}
     ]$J$::jsonb),

    -- Frame 3: rep 2 setup — A2 on ball, D2 defending, lines shuffled
    (v_drill_id, 3, 1500, 'Rep 2 setup — A2 on ball, D2 facing up. Lines shuffled forward.',
     $J$[
       {"id":"g1","type":"mini-goal","x":50,"y":10},
       {"id":"g2","type":"mini-goal","x":50,"y":90},
       {"id":"a1","type":"player","x":82,"y":88,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":50,"y":50,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":18,"y":18,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":18,"y":24,"label":"A4","color":"#0ea5e9"},
       {"id":"d1","type":"player","x":18,"y":30,"label":"D1","color":"#ef4444"},
       {"id":"d2","type":"player","x":50,"y":42,"label":"D2","color":"#ef4444"},
       {"id":"d3","type":"player","x":82,"y":76,"label":"D3","color":"#ef4444"},
       {"id":"d4","type":"player","x":82,"y":82,"label":"D4","color":"#ef4444"},
       {"id":"b1","type":"ball","x":50,"y":52,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"t","type":"text","geometry":{"x":50,"y":95,"text":"Next pair — A2 vs D2"}}]$J$::jsonb),

    -- Frame 4: A2 attacks
    (v_drill_id, 4, 1500, 'A2 takes on D2 with a feint.',
     $J$[
       {"id":"g1","type":"mini-goal","x":50,"y":10},
       {"id":"g2","type":"mini-goal","x":50,"y":90},
       {"id":"a1","type":"player","x":82,"y":88,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":58,"y":30,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":18,"y":18,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":18,"y":24,"label":"A4","color":"#0ea5e9"},
       {"id":"d1","type":"player","x":18,"y":30,"label":"D1","color":"#ef4444"},
       {"id":"d2","type":"player","x":48,"y":36,"label":"D2","color":"#ef4444"},
       {"id":"d3","type":"player","x":82,"y":76,"label":"D3","color":"#ef4444"},
       {"id":"d4","type":"player","x":82,"y":82,"label":"D4","color":"#ef4444"},
       {"id":"b1","type":"ball","x":60,"y":30,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":50},"to":{"x":60,"y":30}},"style":{"color":"#fbbf24"}}]$J$::jsonb),

    -- Frame 5: A2 finishes + rotate
    (v_drill_id, 5, 1600, 'A2 finishes — Goal! Rotate again.',
     $J$[
       {"id":"g1","type":"mini-goal","x":50,"y":10},
       {"id":"g2","type":"mini-goal","x":50,"y":90},
       {"id":"a1","type":"player","x":82,"y":82,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":82,"y":88,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":18,"y":18,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":18,"y":24,"label":"A4","color":"#0ea5e9"},
       {"id":"d1","type":"player","x":18,"y":24,"label":"D1","color":"#ef4444"},
       {"id":"d2","type":"player","x":18,"y":30,"label":"D2","color":"#ef4444"},
       {"id":"d3","type":"player","x":82,"y":76,"label":"D3","color":"#ef4444"},
       {"id":"d4","type":"player","x":82,"y":82,"label":"D4","color":"#ef4444"},
       {"id":"b1","type":"ball","x":50,"y":10,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[
       {"id":"sh","type":"arrow-solid","geometry":{"from":{"x":60,"y":28},"to":{"x":50,"y":12}},"style":{"color":"#22c55e"}},
       {"id":"goal","type":"text","geometry":{"x":65,"y":12,"text":"Goal!"}}
     ]$J$::jsonb),

    -- Frame 6: rep 3 setup
    (v_drill_id, 6, 1500, 'Rep 3 setup — A3 vs D3.',
     $J$[
       {"id":"g1","type":"mini-goal","x":50,"y":10},
       {"id":"g2","type":"mini-goal","x":50,"y":90},
       {"id":"a1","type":"player","x":82,"y":82,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":82,"y":88,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":50,"y":50,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":18,"y":18,"label":"A4","color":"#0ea5e9"},
       {"id":"d1","type":"player","x":18,"y":24,"label":"D1","color":"#ef4444"},
       {"id":"d2","type":"player","x":18,"y":30,"label":"D2","color":"#ef4444"},
       {"id":"d3","type":"player","x":50,"y":42,"label":"D3","color":"#ef4444"},
       {"id":"d4","type":"player","x":82,"y":76,"label":"D4","color":"#ef4444"},
       {"id":"b1","type":"ball","x":50,"y":52,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"t","type":"text","geometry":{"x":50,"y":95,"text":"Next pair — A3 vs D3"}}]$J$::jsonb),

    -- Frame 7: attack
    (v_drill_id, 7, 1500, 'A3 drives at D3.',
     $J$[
       {"id":"g1","type":"mini-goal","x":50,"y":10},
       {"id":"g2","type":"mini-goal","x":50,"y":90},
       {"id":"a1","type":"player","x":82,"y":82,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":82,"y":88,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":42,"y":30,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":18,"y":18,"label":"A4","color":"#0ea5e9"},
       {"id":"d1","type":"player","x":18,"y":24,"label":"D1","color":"#ef4444"},
       {"id":"d2","type":"player","x":18,"y":30,"label":"D2","color":"#ef4444"},
       {"id":"d3","type":"player","x":52,"y":36,"label":"D3","color":"#ef4444"},
       {"id":"d4","type":"player","x":82,"y":76,"label":"D4","color":"#ef4444"},
       {"id":"b1","type":"ball","x":40,"y":30,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":50},"to":{"x":40,"y":30}},"style":{"color":"#fbbf24"}}]$J$::jsonb),

    -- Frame 8: A3 finishes + rotate
    (v_drill_id, 8, 1600, 'A3 finishes — Goal! Loop continues with A4 vs D4.',
     $J$[
       {"id":"g1","type":"mini-goal","x":50,"y":10},
       {"id":"g2","type":"mini-goal","x":50,"y":90},
       {"id":"a1","type":"player","x":82,"y":76,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":82,"y":82,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":82,"y":88,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":18,"y":18,"label":"A4","color":"#0ea5e9"},
       {"id":"d1","type":"player","x":18,"y":18,"label":"D1","color":"#ef4444"},
       {"id":"d2","type":"player","x":18,"y":24,"label":"D2","color":"#ef4444"},
       {"id":"d3","type":"player","x":18,"y":30,"label":"D3","color":"#ef4444"},
       {"id":"d4","type":"player","x":82,"y":76,"label":"D4","color":"#ef4444"},
       {"id":"b1","type":"ball","x":50,"y":10,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[
       {"id":"sh","type":"arrow-solid","geometry":{"from":{"x":40,"y":28},"to":{"x":50,"y":12}},"style":{"color":"#22c55e"}},
       {"id":"goal","type":"text","geometry":{"x":65,"y":12,"text":"Goal!"}},
       {"id":"t","type":"text","geometry":{"x":50,"y":95,"text":"Next pair: A4 vs D4"}}
     ]$J$::jsonb);
  END IF;

  -- ============================================================================
  -- 5. COMBINATION TO GOAL — wall pass A → B → A → shoot.
  -- Goal at (50,12). B (wall) at (50,40). A starts at (50,65).
  -- A line at x=22, y=78,82,86. B line at x=78, y=78,82,86.
  -- A passes to B, B sets back, A finishes; A jogs to back of B line; B jogs to back of A line.
  -- ============================================================================
  SELECT id INTO v_drill_id FROM public.drills
   WHERE name='Combination to goal' AND is_official=true LIMIT 1;
  IF v_drill_id IS NOT NULL THEN
    DELETE FROM public.drill_frames WHERE drill_id = v_drill_id;

    INSERT INTO public.drill_frames (drill_id, position, duration_ms, notes, objects, annotations) VALUES
    -- Frame 0: setup
    (v_drill_id, 0, 1400, 'Setup — A1 on the ball, B1 in the wall position. Queues at each corner.',
     $J$[
       {"id":"g1","type":"goal","x":50,"y":12},
       {"id":"cA","type":"cone","x":50,"y":65,"color":"#0ea5e9"},
       {"id":"cB","type":"cone","x":50,"y":40,"color":"#22c55e"},
       {"id":"a1","type":"player","x":50,"y":65,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":22,"y":78,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":22,"y":82,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":22,"y":86,"label":"A4","color":"#0ea5e9"},
       {"id":"b1","type":"player","x":50,"y":40,"label":"B1","color":"#22c55e"},
       {"id":"b2","type":"player","x":78,"y":78,"label":"B2","color":"#22c55e"},
       {"id":"b3","type":"player","x":78,"y":82,"label":"B3","color":"#22c55e"},
       {"id":"b4","type":"player","x":78,"y":86,"label":"B4","color":"#22c55e"},
       {"id":"ball","type":"ball","x":50,"y":65,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"t","type":"text","geometry":{"x":50,"y":94,"text":"A → B → A → shoot. A & B swap lines."}}]$J$::jsonb),

    -- Frame 1: A1 plays into B1
    (v_drill_id, 1, 1300, 'A1 plays into B1, then breaks forward.',
     $J$[
       {"id":"g1","type":"goal","x":50,"y":12},
       {"id":"cA","type":"cone","x":50,"y":65,"color":"#0ea5e9"},
       {"id":"cB","type":"cone","x":50,"y":40,"color":"#22c55e"},
       {"id":"a1","type":"player","x":50,"y":55,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":22,"y":78,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":22,"y":82,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":22,"y":86,"label":"A4","color":"#0ea5e9"},
       {"id":"b1","type":"player","x":50,"y":40,"label":"B1","color":"#22c55e"},
       {"id":"b2","type":"player","x":78,"y":78,"label":"B2","color":"#22c55e"},
       {"id":"b3","type":"player","x":78,"y":82,"label":"B3","color":"#22c55e"},
       {"id":"b4","type":"player","x":78,"y":86,"label":"B4","color":"#22c55e"},
       {"id":"ball","type":"ball","x":50,"y":42,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":63},"to":{"x":50,"y":42}},"style":{"color":"#fbbf24"}}]$J$::jsonb),

    -- Frame 2: B1 sets back; A1 has run on; A1 strikes; rotate
    (v_drill_id, 2, 1600, 'B1 sets back, A1 strikes — Goal! A1 → back of B line, B1 → back of A line.',
     $J$[
       {"id":"g1","type":"goal","x":50,"y":12},
       {"id":"cA","type":"cone","x":50,"y":65,"color":"#0ea5e9"},
       {"id":"cB","type":"cone","x":50,"y":40,"color":"#22c55e"},
       {"id":"a1","type":"player","x":78,"y":86,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":22,"y":78,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":22,"y":82,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":22,"y":86,"label":"A4","color":"#0ea5e9"},
       {"id":"b1","type":"player","x":22,"y":86,"label":"B1","color":"#22c55e"},
       {"id":"b2","type":"player","x":78,"y":78,"label":"B2","color":"#22c55e"},
       {"id":"b3","type":"player","x":78,"y":82,"label":"B3","color":"#22c55e"},
       {"id":"b4","type":"player","x":78,"y":86,"label":"B4","color":"#22c55e"},
       {"id":"ball","type":"ball","x":50,"y":12,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[
       {"id":"set","type":"arrow-solid","geometry":{"from":{"x":50,"y":42},"to":{"x":50,"y":50}},"style":{"color":"#fbbf24"}},
       {"id":"sh","type":"arrow-solid","geometry":{"from":{"x":50,"y":48},"to":{"x":50,"y":14}},"style":{"color":"#22c55e"}},
       {"id":"goal","type":"text","geometry":{"x":65,"y":14,"text":"Goal!"}},
       {"id":"r1","type":"arrow-dashed","geometry":{"from":{"x":50,"y":35},"to":{"x":78,"y":86}},"style":{"color":"#a78bfa"}},
       {"id":"r2","type":"arrow-dashed","geometry":{"from":{"x":50,"y":42},"to":{"x":22,"y":86}},"style":{"color":"#a78bfa"}}
     ]$J$::jsonb),

    -- Frame 3: rep 2 setup — A2 on ball, B2 in wall slot. Queues shuffled.
    (v_drill_id, 3, 1400, 'Rep 2 — A2 on ball, B2 in wall position.',
     $J$[
       {"id":"g1","type":"goal","x":50,"y":12},
       {"id":"cA","type":"cone","x":50,"y":65,"color":"#0ea5e9"},
       {"id":"cB","type":"cone","x":50,"y":40,"color":"#22c55e"},
       {"id":"a1","type":"player","x":78,"y":86,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":50,"y":65,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":22,"y":78,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":22,"y":82,"label":"A4","color":"#0ea5e9"},
       {"id":"b1","type":"player","x":22,"y":86,"label":"B1","color":"#22c55e"},
       {"id":"b2","type":"player","x":50,"y":40,"label":"B2","color":"#22c55e"},
       {"id":"b3","type":"player","x":78,"y":78,"label":"B3","color":"#22c55e"},
       {"id":"b4","type":"player","x":78,"y":82,"label":"B4","color":"#22c55e"},
       {"id":"ball","type":"ball","x":50,"y":65,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"t","type":"text","geometry":{"x":50,"y":94,"text":"Next pair — A2 + B2"}}]$J$::jsonb),

    -- Frame 4: pass in
    (v_drill_id, 4, 1300, 'A2 plays B2, breaks forward.',
     $J$[
       {"id":"g1","type":"goal","x":50,"y":12},
       {"id":"cA","type":"cone","x":50,"y":65,"color":"#0ea5e9"},
       {"id":"cB","type":"cone","x":50,"y":40,"color":"#22c55e"},
       {"id":"a1","type":"player","x":78,"y":86,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":50,"y":55,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":22,"y":78,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":22,"y":82,"label":"A4","color":"#0ea5e9"},
       {"id":"b1","type":"player","x":22,"y":86,"label":"B1","color":"#22c55e"},
       {"id":"b2","type":"player","x":50,"y":40,"label":"B2","color":"#22c55e"},
       {"id":"b3","type":"player","x":78,"y":78,"label":"B3","color":"#22c55e"},
       {"id":"b4","type":"player","x":78,"y":82,"label":"B4","color":"#22c55e"},
       {"id":"ball","type":"ball","x":50,"y":42,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":63},"to":{"x":50,"y":42}},"style":{"color":"#fbbf24"}}]$J$::jsonb),

    -- Frame 5: finish + rotate
    (v_drill_id, 5, 1600, 'B2 sets back, A2 finishes — Goal! Rotate.',
     $J$[
       {"id":"g1","type":"goal","x":50,"y":12},
       {"id":"cA","type":"cone","x":50,"y":65,"color":"#0ea5e9"},
       {"id":"cB","type":"cone","x":50,"y":40,"color":"#22c55e"},
       {"id":"a1","type":"player","x":78,"y":82,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":78,"y":86,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":22,"y":78,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":22,"y":82,"label":"A4","color":"#0ea5e9"},
       {"id":"b1","type":"player","x":22,"y":82,"label":"B1","color":"#22c55e"},
       {"id":"b2","type":"player","x":22,"y":86,"label":"B2","color":"#22c55e"},
       {"id":"b3","type":"player","x":78,"y":78,"label":"B3","color":"#22c55e"},
       {"id":"b4","type":"player","x":78,"y":82,"label":"B4","color":"#22c55e"},
       {"id":"ball","type":"ball","x":50,"y":12,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[
       {"id":"set","type":"arrow-solid","geometry":{"from":{"x":50,"y":42},"to":{"x":50,"y":50}},"style":{"color":"#fbbf24"}},
       {"id":"sh","type":"arrow-solid","geometry":{"from":{"x":50,"y":48},"to":{"x":50,"y":14}},"style":{"color":"#22c55e"}},
       {"id":"goal","type":"text","geometry":{"x":65,"y":14,"text":"Goal!"}}
     ]$J$::jsonb),

    -- Frame 6: rep 3 setup
    (v_drill_id, 6, 1400, 'Rep 3 — A3 on ball, B3 in wall position.',
     $J$[
       {"id":"g1","type":"goal","x":50,"y":12},
       {"id":"cA","type":"cone","x":50,"y":65,"color":"#0ea5e9"},
       {"id":"cB","type":"cone","x":50,"y":40,"color":"#22c55e"},
       {"id":"a1","type":"player","x":78,"y":82,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":78,"y":86,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":50,"y":65,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":22,"y":78,"label":"A4","color":"#0ea5e9"},
       {"id":"b1","type":"player","x":22,"y":82,"label":"B1","color":"#22c55e"},
       {"id":"b2","type":"player","x":22,"y":86,"label":"B2","color":"#22c55e"},
       {"id":"b3","type":"player","x":50,"y":40,"label":"B3","color":"#22c55e"},
       {"id":"b4","type":"player","x":78,"y":78,"label":"B4","color":"#22c55e"},
       {"id":"ball","type":"ball","x":50,"y":65,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"t","type":"text","geometry":{"x":50,"y":94,"text":"Next pair — A3 + B3"}}]$J$::jsonb),

    -- Frame 7: pass
    (v_drill_id, 7, 1300, 'A3 plays B3, breaks forward.',
     $J$[
       {"id":"g1","type":"goal","x":50,"y":12},
       {"id":"cA","type":"cone","x":50,"y":65,"color":"#0ea5e9"},
       {"id":"cB","type":"cone","x":50,"y":40,"color":"#22c55e"},
       {"id":"a1","type":"player","x":78,"y":82,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":78,"y":86,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":50,"y":55,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":22,"y":78,"label":"A4","color":"#0ea5e9"},
       {"id":"b1","type":"player","x":22,"y":82,"label":"B1","color":"#22c55e"},
       {"id":"b2","type":"player","x":22,"y":86,"label":"B2","color":"#22c55e"},
       {"id":"b3","type":"player","x":50,"y":40,"label":"B3","color":"#22c55e"},
       {"id":"b4","type":"player","x":78,"y":78,"label":"B4","color":"#22c55e"},
       {"id":"ball","type":"ball","x":50,"y":42,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[{"id":"a1","type":"arrow-solid","geometry":{"from":{"x":50,"y":63},"to":{"x":50,"y":42}},"style":{"color":"#fbbf24"}}]$J$::jsonb),

    -- Frame 8: finish + rotate; ready for A4+B4
    (v_drill_id, 8, 1600, 'B3 sets, A3 finishes — Goal! Loop continues with A4 + B4.',
     $J$[
       {"id":"g1","type":"goal","x":50,"y":12},
       {"id":"cA","type":"cone","x":50,"y":65,"color":"#0ea5e9"},
       {"id":"cB","type":"cone","x":50,"y":40,"color":"#22c55e"},
       {"id":"a1","type":"player","x":78,"y":78,"label":"A1","color":"#0ea5e9"},
       {"id":"a2","type":"player","x":78,"y":82,"label":"A2","color":"#0ea5e9"},
       {"id":"a3","type":"player","x":78,"y":86,"label":"A3","color":"#0ea5e9"},
       {"id":"a4","type":"player","x":22,"y":78,"label":"A4","color":"#0ea5e9"},
       {"id":"b1","type":"player","x":22,"y":78,"label":"B1","color":"#22c55e"},
       {"id":"b2","type":"player","x":22,"y":82,"label":"B2","color":"#22c55e"},
       {"id":"b3","type":"player","x":22,"y":86,"label":"B3","color":"#22c55e"},
       {"id":"b4","type":"player","x":78,"y":78,"label":"B4","color":"#22c55e"},
       {"id":"ball","type":"ball","x":50,"y":12,"color":"#f5f5f5"}
     ]$J$::jsonb,
     $J$[
       {"id":"set","type":"arrow-solid","geometry":{"from":{"x":50,"y":42},"to":{"x":50,"y":50}},"style":{"color":"#fbbf24"}},
       {"id":"sh","type":"arrow-solid","geometry":{"from":{"x":50,"y":48},"to":{"x":50,"y":14}},"style":{"color":"#22c55e"}},
       {"id":"goal","type":"text","geometry":{"x":65,"y":14,"text":"Goal!"}},
       {"id":"t","type":"text","geometry":{"x":50,"y":94,"text":"Next pair: A4 + B4"}}
     ]$J$::jsonb);
  END IF;
END $$;
