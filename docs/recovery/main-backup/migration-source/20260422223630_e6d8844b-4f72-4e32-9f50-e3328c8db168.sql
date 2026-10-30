
-- =====================================================================
-- Append alternate-outcome (defender wins) frames to the remaining
-- contest-style drills so the demo doesn't always show the attacker
-- side winning. Each drill gets two new positions:
--   max+1 : defender intercepts / wins the duel
--   max+2 : defender clears the ball upfield (dy > +20 anchored on a
--           red chip — the contest-fairness validator's "alternate
--           outcome" signal).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 4v4 small-sided game  (existing max position = 4)
-- id: eff224eb-34ba-4386-aaa8-82d1a0b29079
-- ---------------------------------------------------------------------
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  'eff224eb-34ba-4386-aaa8-82d1a0b29079', 5, 2200,
  'Next rep — different mix of players. This time red presses early and intercepts the cross-field switch before blue can build the overload.',
  $JSON$[
    {"id":"g1","type":"full-goal","x":50,"y":10},
    {"id":"g2","type":"full-goal","x":50,"y":90},
    {"id":"p1","type":"player","color":"#0ea5e9","x":22,"y":62},
    {"id":"p2","type":"player","color":"#0ea5e9","x":78,"y":68},
    {"id":"p3","type":"player","color":"#0ea5e9","x":35,"y":52},
    {"id":"p4","type":"player","color":"#0ea5e9","x":62,"y":52},
    {"id":"p5","type":"player","color":"#ef4444","x":48,"y":48},
    {"id":"p6","type":"player","color":"#ef4444","x":52,"y":50},
    {"id":"p7","type":"player","color":"#ef4444","x":35,"y":48},
    {"id":"p8","type":"player","color":"#ef4444","x":68,"y":50},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":48,"y":48}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":48,"y":48},"to":{"x":48,"y":50}}},
    {"id":"t1","type":"text","geometry":{"text":"Red intercepts the switch","x":50,"y":30}}
  ]$JSON$::jsonb
);

INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  'eff224eb-34ba-4386-aaa8-82d1a0b29079', 6, 2200,
  'Red turns it over and drives forward — counter-attack toward the blue goal. Possession swings back; reset for the next rep.',
  $JSON$[
    {"id":"g1","type":"full-goal","x":50,"y":10},
    {"id":"g2","type":"full-goal","x":50,"y":90},
    {"id":"p1","type":"player","color":"#0ea5e9","x":22,"y":62},
    {"id":"p2","type":"player","color":"#0ea5e9","x":78,"y":65},
    {"id":"p3","type":"player","color":"#0ea5e9","x":35,"y":50},
    {"id":"p4","type":"player","color":"#0ea5e9","x":62,"y":50},
    {"id":"p5","type":"player","color":"#ef4444","x":48,"y":55},
    {"id":"p6","type":"player","color":"#ef4444","x":52,"y":50},
    {"id":"p7","type":"player","color":"#ef4444","x":40,"y":50},
    {"id":"p8","type":"player","color":"#ef4444","x":62,"y":52},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":85}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":48,"y":48},"to":{"x":50,"y":85}}},
    {"id":"t1","type":"text","geometry":{"text":"Counter-attack — possession swings","x":50,"y":35}}
  ]$JSON$::jsonb
);

-- ---------------------------------------------------------------------
-- Defensive shape walk-through  (existing max position = 4)
-- id: f490eb3a-5454-488c-8157-9272b73891fe
-- ---------------------------------------------------------------------
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  'f490eb3a-5454-488c-8157-9272b73891fe', 5, 2200,
  'Next rep — D2 reads the angle of the next ball, steps off the back four and intercepts in front of the attackers. Defenders win the rep.',
  $JSON$[
    {"id":"d1","type":"player","label":"D1","color":"#ef4444","x":25,"y":62},
    {"id":"d2","type":"player","label":"D2","color":"#ef4444","x":42,"y":52},
    {"id":"d3","type":"player","label":"D3","color":"#ef4444","x":58,"y":62},
    {"id":"d4","type":"player","label":"D4","color":"#ef4444","x":75,"y":62},
    {"id":"a1","type":"player","label":"A1","color":"#0ea5e9","x":25,"y":42},
    {"id":"a2","type":"player","label":"A2","color":"#0ea5e9","x":42,"y":42},
    {"id":"a3","type":"player","label":"A3","color":"#0ea5e9","x":58,"y":42},
    {"id":"a4","type":"player","label":"A4","color":"#0ea5e9","x":75,"y":42},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":42,"y":52},
    {"id":"g1","type":"goal","x":50,"y":10}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":42,"y":52},"to":{"x":42,"y":54}}},
    {"id":"t1","type":"text","geometry":{"text":"D2 steps in — intercepts","x":50,"y":80}}
  ]$JSON$::jsonb
);

INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  'f490eb3a-5454-488c-8157-9272b73891fe', 6, 2200,
  'D2 plays a long clearance away from the goal back to safety. Reset shape and start the next rep.',
  $JSON$[
    {"id":"d1","type":"player","label":"D1","color":"#ef4444","x":25,"y":62},
    {"id":"d2","type":"player","label":"D2","color":"#ef4444","x":42,"y":58},
    {"id":"d3","type":"player","label":"D3","color":"#ef4444","x":58,"y":62},
    {"id":"d4","type":"player","label":"D4","color":"#ef4444","x":75,"y":62},
    {"id":"a1","type":"player","label":"A1","color":"#0ea5e9","x":25,"y":42},
    {"id":"a2","type":"player","label":"A2","color":"#0ea5e9","x":42,"y":42},
    {"id":"a3","type":"player","label":"A3","color":"#0ea5e9","x":58,"y":42},
    {"id":"a4","type":"player","label":"A4","color":"#0ea5e9","x":75,"y":42},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":92},
    {"id":"g1","type":"goal","x":50,"y":10}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":42,"y":52},"to":{"x":50,"y":92}}},
    {"id":"t1","type":"text","geometry":{"text":"Clearance — reset shape","x":50,"y":80}}
  ]$JSON$::jsonb
);

-- ---------------------------------------------------------------------
-- Piggy in the middle  (existing max position = 4)
-- id: 77e4d298-1c2c-406f-b0e9-a62185f8f187
-- ---------------------------------------------------------------------
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '77e4d298-1c2c-406f-b0e9-a62185f8f187', 5, 2000,
  'Next rep — sharper middle player. P reads the next pass and intercepts it as it travels across the grid.',
  $JSON$[
    {"id":"c1","type":"cone","color":"#f97316","x":25,"y":30,"size":1,"rotation":0},
    {"id":"c2","type":"cone","color":"#f97316","x":75,"y":30,"size":1,"rotation":0},
    {"id":"c3","type":"cone","color":"#f97316","x":25,"y":70,"size":1,"rotation":0},
    {"id":"c4","type":"cone","color":"#f97316","x":75,"y":70,"size":1,"rotation":0},
    {"id":"a1","type":"player","label":"1","color":"#0ea5e9","x":35,"y":50,"size":1,"rotation":0},
    {"id":"a2","type":"player","label":"2","color":"#0ea5e9","x":65,"y":50,"size":1,"rotation":0},
    {"id":"d1","type":"player","label":"P","color":"#ef4444","x":50,"y":50,"size":1,"rotation":0},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":50,"size":1,"rotation":0}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":50,"y":50},"to":{"x":50,"y":52}}},
    {"id":"t1","type":"text","geometry":{"text":"P intercepts — wins the round","x":50,"y":20}}
  ]$JSON$::jsonb
);

INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '77e4d298-1c2c-406f-b0e9-a62185f8f187', 6, 2000,
  'P escapes with the ball — whoever played the pass takes their turn in the middle for the next round.',
  $JSON$[
    {"id":"c1","type":"cone","color":"#f97316","x":25,"y":30,"size":1,"rotation":0},
    {"id":"c2","type":"cone","color":"#f97316","x":75,"y":30,"size":1,"rotation":0},
    {"id":"c3","type":"cone","color":"#f97316","x":25,"y":70,"size":1,"rotation":0},
    {"id":"c4","type":"cone","color":"#f97316","x":75,"y":70,"size":1,"rotation":0},
    {"id":"a1","type":"player","label":"1","color":"#0ea5e9","x":35,"y":50,"size":1,"rotation":0},
    {"id":"a2","type":"player","label":"2","color":"#0ea5e9","x":65,"y":50,"size":1,"rotation":0},
    {"id":"d1","type":"player","label":"P","color":"#ef4444","x":52,"y":55,"size":1,"rotation":0},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":52,"y":85,"size":1,"rotation":0}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":50,"y":50},"to":{"x":52,"y":85}}},
    {"id":"t1","type":"text","geometry":{"text":"Roles swap — passer goes in next","x":50,"y":20}}
  ]$JSON$::jsonb
);

-- ---------------------------------------------------------------------
-- Receive under pressure  (existing max position = 4)
-- id: 9e5ccac2-7c2f-4d0d-aeef-aad5042b27b2
-- ---------------------------------------------------------------------
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '9e5ccac2-7c2f-4d0d-aeef-aad5042b27b2', 5, 2200,
  'Next rep — D1 reads it, gets tight before A1 can settle, and nicks the ball away as A1 receives.',
  $JSON$[
    {"id":"s","type":"player","label":"S","color":"#94a3b8","x":50,"y":80,"size":1,"rotation":0},
    {"id":"a1","type":"player","label":"A1","color":"#0ea5e9","x":50,"y":52,"size":1,"rotation":0},
    {"id":"d1","type":"player","label":"D1","color":"#ef4444","x":50,"y":50,"size":1,"rotation":0},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":50,"size":1,"rotation":0}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":50,"y":50},"to":{"x":50,"y":52}}},
    {"id":"t1","type":"text","geometry":{"text":"D1 wins the duel","x":50,"y":20}}
  ]$JSON$::jsonb
);

INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '9e5ccac2-7c2f-4d0d-aeef-aad5042b27b2', 6, 2200,
  'D1 turns and clears the ball back to the server. Roles rotate — A1 becomes the next defender.',
  $JSON$[
    {"id":"s","type":"player","label":"S","color":"#94a3b8","x":50,"y":80,"size":1,"rotation":0},
    {"id":"a1","type":"player","label":"A1","color":"#0ea5e9","x":50,"y":55,"size":1,"rotation":0},
    {"id":"d1","type":"player","label":"D1","color":"#ef4444","x":50,"y":50,"size":1,"rotation":0},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":78,"size":1,"rotation":0}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":50,"y":50},"to":{"x":50,"y":78}}},
    {"id":"t1","type":"text","geometry":{"text":"Clearance back to S — rotate roles","x":50,"y":20}}
  ]$JSON$::jsonb
);

-- ---------------------------------------------------------------------
-- Throw-in basics & receive  (existing max position = 4)
-- id: bc5ca411-17f4-45c0-928f-b10efebb628f
-- ---------------------------------------------------------------------
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  'bc5ca411-17f4-45c0-928f-b10efebb628f', 5, 2200,
  'Next rep — defender D reads the throw and steps in front of the receiver to intercept the ball before it lands.',
  $JSON$[
    {"id":"c1","type":"cone","color":"#f97316","x":8,"y":30,"size":1,"rotation":0},
    {"id":"c2","type":"cone","color":"#f97316","x":8,"y":70,"size":1,"rotation":0},
    {"id":"th","type":"player","label":"T","color":"#0ea5e9","x":8,"y":50,"size":1,"rotation":0},
    {"id":"r1","type":"player","label":"R1","color":"#0ea5e9","x":30,"y":35,"size":1,"rotation":0},
    {"id":"r2","type":"player","label":"R2","color":"#0ea5e9","x":35,"y":65,"size":1,"rotation":0},
    {"id":"d1","type":"player","label":"D","color":"#ef4444","x":28,"y":40,"size":1,"rotation":0},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":28,"y":40,"size":1,"rotation":0}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":28,"y":40},"to":{"x":28,"y":42}}},
    {"id":"t1","type":"text","geometry":{"text":"D reads the throw — intercepts","x":50,"y":12}}
  ]$JSON$::jsonb
);

INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  'bc5ca411-17f4-45c0-928f-b10efebb628f', 6, 2200,
  'D clears the ball away from the receiving area. Throw-in is wasted — coach calls a re-take, swap roles for the next rep.',
  $JSON$[
    {"id":"c1","type":"cone","color":"#f97316","x":8,"y":30,"size":1,"rotation":0},
    {"id":"c2","type":"cone","color":"#f97316","x":8,"y":70,"size":1,"rotation":0},
    {"id":"th","type":"player","label":"T","color":"#0ea5e9","x":8,"y":50,"size":1,"rotation":0},
    {"id":"r1","type":"player","label":"R1","color":"#0ea5e9","x":30,"y":35,"size":1,"rotation":0},
    {"id":"r2","type":"player","label":"R2","color":"#0ea5e9","x":35,"y":65,"size":1,"rotation":0},
    {"id":"d1","type":"player","label":"D","color":"#ef4444","x":35,"y":45,"size":1,"rotation":0},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":85,"size":1,"rotation":0}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":28,"y":40},"to":{"x":50,"y":85}}},
    {"id":"t1","type":"text","geometry":{"text":"Clearance — re-take, swap roles","x":50,"y":12}}
  ]$JSON$::jsonb
);

-- ---------------------------------------------------------------------
-- Wall-pass and finish  (existing max position = 4)
-- id: 09c0af18-90d4-4225-960a-fe431898ad84
-- ---------------------------------------------------------------------
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '09c0af18-90d4-4225-960a-fe431898ad84', 5, 2200,
  'Next rep — D1 reads the 1-2 early, anticipates the return pass and intercepts before the wall plays it back.',
  $JSON$[
    {"id":"g1","type":"goal","x":50,"y":8},
    {"id":"gk","type":"player","label":"GK","color":"#fbbf24","x":50,"y":14,"size":1,"rotation":0},
    {"id":"a1","type":"player","label":"A1","color":"#0ea5e9","x":50,"y":62,"size":1,"rotation":0},
    {"id":"w","type":"player","label":"W","color":"#94a3b8","x":35,"y":50,"size":1,"rotation":0},
    {"id":"d1","type":"player","label":"D1","color":"#ef4444","x":40,"y":48,"size":1,"rotation":0},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":40,"y":48,"size":1,"rotation":0}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":40,"y":48},"to":{"x":40,"y":50}}},
    {"id":"t1","type":"text","geometry":{"text":"D1 reads the 1-2 — intercepts","x":50,"y":85}}
  ]$JSON$::jsonb
);

INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '09c0af18-90d4-4225-960a-fe431898ad84', 6, 2200,
  'D1 clears the ball upfield away from goal — attack broken down, reset for the next pair.',
  $JSON$[
    {"id":"g1","type":"goal","x":50,"y":8},
    {"id":"gk","type":"player","label":"GK","color":"#fbbf24","x":50,"y":14,"size":1,"rotation":0},
    {"id":"a1","type":"player","label":"A1","color":"#0ea5e9","x":50,"y":65,"size":1,"rotation":0},
    {"id":"w","type":"player","label":"W","color":"#94a3b8","x":35,"y":50,"size":1,"rotation":0},
    {"id":"d1","type":"player","label":"D1","color":"#ef4444","x":42,"y":55,"size":1,"rotation":0},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":90,"size":1,"rotation":0}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":40,"y":48},"to":{"x":50,"y":90}}},
    {"id":"t1","type":"text","geometry":{"text":"Clearance — reset for next pair","x":50,"y":85}}
  ]$JSON$::jsonb
);
