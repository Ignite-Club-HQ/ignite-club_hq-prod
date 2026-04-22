-- =====================================================================
-- 1v1 contest drills: append "alternate outcome" frames so the demo
-- doesn't always show the attacker winning. This communicates that
-- the outcome of the contest depends on the players involved and
-- naturally rotates as different pairs cycle through.
--
-- For each drill we append:
--   position N+1: the defender wins the duel (intercepts / clears /
--                 forces the ball out)
--   position N+2: defender resolves (clearance away / dispossess)
-- with a text annotation explaining the rotation principle.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1v1 attack with feint  (existing max position = 6)
-- ---------------------------------------------------------------------
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  'a015a46c-1380-4433-b149-87da1434a839', 7, 2200,
  'Next rep — different players, different outcome. This time the defender reads the feint, stays on their feet and steals the ball as the attacker commits.',
  $JSON$[
    {"id":"w1","type":"player","label":"W1","color":"#94a3b8","x":38,"y":90},
    {"id":"w2","type":"player","label":"W2","color":"#94a3b8","x":62,"y":90},
    {"id":"p1","type":"player","label":"A","color":"#0ea5e9","x":48,"y":50},
    {"id":"p2","type":"player","label":"D","color":"#ef4444","x":50,"y":45},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":46},
    {"id":"c1","type":"cone","color":"#f97316","x":30,"y":20},
    {"id":"c2","type":"cone","color":"#f97316","x":70,"y":20},
    {"id":"c3","type":"cone","color":"#f97316","x":30,"y":85},
    {"id":"c4","type":"cone","color":"#f97316","x":70,"y":85},
    {"id":"g1","type":"mini-goal","x":50,"y":10}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":50,"y":45},"to":{"x":50,"y":48}}},
    {"id":"t1","type":"text","geometry":{"text":"Outcomes vary — same drill, different players","x":50,"y":62}}
  ]$JSON$::jsonb
);

INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  'a015a46c-1380-4433-b149-87da1434a839', 8, 2200,
  'Defender clears the ball away from danger. Attacker resets — both players jog back to the queue and the next pair steps in.',
  $JSON$[
    {"id":"w1","type":"player","label":"W1","color":"#94a3b8","x":38,"y":90},
    {"id":"w2","type":"player","label":"W2","color":"#94a3b8","x":62,"y":90},
    {"id":"p1","type":"player","label":"A","color":"#0ea5e9","x":52,"y":55},
    {"id":"p2","type":"player","label":"D","color":"#ef4444","x":48,"y":40},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":40,"y":78},
    {"id":"c1","type":"cone","color":"#f97316","x":30,"y":20},
    {"id":"c2","type":"cone","color":"#f97316","x":70,"y":20},
    {"id":"c3","type":"cone","color":"#f97316","x":30,"y":85},
    {"id":"c4","type":"cone","color":"#f97316","x":70,"y":85},
    {"id":"g1","type":"mini-goal","x":50,"y":10}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":50,"y":46},"to":{"x":40,"y":78}}},
    {"id":"t1","type":"text","geometry":{"text":"Defender clears — reset for next rep","x":50,"y":30}}
  ]$JSON$::jsonb
);

-- ---------------------------------------------------------------------
-- 1v1 defending channel  (existing max position = 6)
-- ---------------------------------------------------------------------
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '3b67d29e-507e-4432-b20b-91805ffdc825', 7, 2200,
  'Next rep — defender jockeys patiently, forces the attacker wide and wins the ball as they overcommit. Same drill, different outcome.',
  $JSON$[
    {"id":"w1","type":"player","label":"W1","color":"#94a3b8","x":38,"y":90},
    {"id":"w2","type":"player","label":"W2","color":"#94a3b8","x":62,"y":90},
    {"id":"p1","type":"player","label":"A","color":"#ef4444","x":62,"y":55},
    {"id":"p2","type":"player","label":"D","color":"#0ea5e9","x":58,"y":58},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":60,"y":58},
    {"id":"c1","type":"cone","color":"#f97316","x":30,"y":15},
    {"id":"c2","type":"cone","color":"#f97316","x":70,"y":15},
    {"id":"c3","type":"cone","color":"#f97316","x":30,"y":85},
    {"id":"c4","type":"cone","color":"#f97316","x":70,"y":85},
    {"id":"g1","type":"mini-goal","x":50,"y":90}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#0ea5e9"},"geometry":{"from":{"x":58,"y":58},"to":{"x":60,"y":58}}},
    {"id":"t1","type":"text","geometry":{"text":"Outcomes vary — same drill, different players","x":50,"y":40}}
  ]$JSON$::jsonb
);

INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '3b67d29e-507e-4432-b20b-91805ffdc825', 8, 2200,
  'Defender wins the tackle and plays out wide for safety. Reset — next pair in.',
  $JSON$[
    {"id":"w1","type":"player","label":"W1","color":"#94a3b8","x":38,"y":90},
    {"id":"w2","type":"player","label":"W2","color":"#94a3b8","x":62,"y":90},
    {"id":"p1","type":"player","label":"A","color":"#ef4444","x":64,"y":60},
    {"id":"p2","type":"player","label":"D","color":"#0ea5e9","x":56,"y":58},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":35,"y":75},
    {"id":"c1","type":"cone","color":"#f97316","x":30,"y":15},
    {"id":"c2","type":"cone","color":"#f97316","x":70,"y":15},
    {"id":"c3","type":"cone","color":"#f97316","x":30,"y":85},
    {"id":"c4","type":"cone","color":"#f97316","x":70,"y":85},
    {"id":"g1","type":"mini-goal","x":50,"y":90}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#0ea5e9"},"geometry":{"from":{"x":56,"y":58},"to":{"x":35,"y":75}}},
    {"id":"t1","type":"text","geometry":{"text":"Cleared wide — reset for next rep","x":50,"y":40}}
  ]$JSON$::jsonb
);

-- ---------------------------------------------------------------------
-- 1v1 to end-zone  (existing max position = 7)
-- ---------------------------------------------------------------------
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '2f7f91d0-5526-42f9-a6c7-c9fb931eeb1e', 8, 2200,
  'Next rep — different players, different result. The defender holds their line, mirrors the attacker''s touch and wins the ball before the end-zone.',
  $JSON$[
    {"id":"p1","type":"player","label":"A","color":"#0ea5e9","x":48,"y":40},
    {"id":"p2","type":"player","label":"D","color":"#ef4444","x":50,"y":35},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":36},
    {"id":"w1","type":"player","label":"W1","color":"#94a3b8","x":38,"y":90},
    {"id":"w2","type":"player","label":"W2","color":"#94a3b8","x":46,"y":90},
    {"id":"w3","type":"player","label":"W3","color":"#94a3b8","x":54,"y":90},
    {"id":"w4","type":"player","label":"W4","color":"#94a3b8","x":62,"y":90},
    {"id":"c1","type":"cone","color":"#f97316","x":25,"y":15},
    {"id":"c2","type":"cone","color":"#f97316","x":75,"y":15},
    {"id":"c3","type":"cone","color":"#f97316","x":25,"y":85},
    {"id":"c4","type":"cone","color":"#f97316","x":75,"y":85},
    {"id":"c5","type":"cone","color":"#f97316","x":25,"y":22},
    {"id":"c6","type":"cone","color":"#f97316","x":75,"y":22},
    {"id":"c7","type":"cone","color":"#f97316","x":25,"y":78},
    {"id":"c8","type":"cone","color":"#f97316","x":75,"y":78}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":50,"y":35},"to":{"x":50,"y":38}}},
    {"id":"t1","type":"text","geometry":{"text":"Outcomes vary — same drill, different players","x":50,"y":55}}
  ]$JSON$::jsonb
);

INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '2f7f91d0-5526-42f9-a6c7-c9fb931eeb1e', 9, 2200,
  'Defender wins the duel and plays the ball back to a coach/server. Both players jog back; W3 and W4 step up next.',
  $JSON$[
    {"id":"p1","type":"player","label":"A","color":"#0ea5e9","x":50,"y":48},
    {"id":"p2","type":"player","label":"D","color":"#ef4444","x":48,"y":36},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":35,"y":70},
    {"id":"w1","type":"player","label":"W1","color":"#94a3b8","x":38,"y":90},
    {"id":"w2","type":"player","label":"W2","color":"#94a3b8","x":46,"y":90},
    {"id":"w3","type":"player","label":"W3","color":"#94a3b8","x":54,"y":90},
    {"id":"w4","type":"player","label":"W4","color":"#94a3b8","x":62,"y":90},
    {"id":"c1","type":"cone","color":"#f97316","x":25,"y":15},
    {"id":"c2","type":"cone","color":"#f97316","x":75,"y":15},
    {"id":"c3","type":"cone","color":"#f97316","x":25,"y":85},
    {"id":"c4","type":"cone","color":"#f97316","x":75,"y":85},
    {"id":"c5","type":"cone","color":"#f97316","x":25,"y":22},
    {"id":"c6","type":"cone","color":"#f97316","x":75,"y":22},
    {"id":"c7","type":"cone","color":"#f97316","x":25,"y":78},
    {"id":"c8","type":"cone","color":"#f97316","x":75,"y":78}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":48,"y":36},"to":{"x":35,"y":70}}},
    {"id":"t1","type":"text","geometry":{"text":"Defender clears — next pair in","x":50,"y":55}}
  ]$JSON$::jsonb
);

-- ---------------------------------------------------------------------
-- 1v1 to mini-goals  (existing max position = 6)
-- ---------------------------------------------------------------------
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '1803b2b8-005b-4a7f-9c18-50579f3fa972', 7, 2200,
  'Next rep — defender wins the tackle at the centre. Same setup, opposite outcome — that''s what naturally happens as different pairs cycle through.',
  $JSON$[
    {"id":"p1","type":"player","label":"A","color":"#0ea5e9","x":48,"y":50},
    {"id":"p2","type":"player","label":"D","color":"#ef4444","x":52,"y":50},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":51,"y":50},
    {"id":"w1","type":"player","label":"W1","color":"#94a3b8","x":38,"y":90},
    {"id":"w2","type":"player","label":"W2","color":"#94a3b8","x":62,"y":90},
    {"id":"g1","type":"mini-goal","x":50,"y":10},
    {"id":"g2","type":"mini-goal","x":50,"y":90}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":52,"y":50},"to":{"x":51,"y":50}}},
    {"id":"t1","type":"text","geometry":{"text":"Outcomes vary — same drill, different players","x":50,"y":68}}
  ]$JSON$::jsonb
);

INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '1803b2b8-005b-4a7f-9c18-50579f3fa972', 8, 2200,
  'Defender wins the ball and breaks toward the opposite mini-goal. Reset — next pair in.',
  $JSON$[
    {"id":"p1","type":"player","label":"A","color":"#0ea5e9","x":48,"y":52},
    {"id":"p2","type":"player","label":"D","color":"#ef4444","x":50,"y":65},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":68},
    {"id":"w1","type":"player","label":"W1","color":"#94a3b8","x":38,"y":90},
    {"id":"w2","type":"player","label":"W2","color":"#94a3b8","x":62,"y":90},
    {"id":"g1","type":"mini-goal","x":50,"y":10},
    {"id":"g2","type":"mini-goal","x":50,"y":90}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":50,"y":50},"to":{"x":50,"y":68}}},
    {"id":"t1","type":"text","geometry":{"text":"Defender drives — reset for next rep","x":50,"y":30}}
  ]$JSON$::jsonb
);

-- ---------------------------------------------------------------------
-- 1v1 with overlap option  (existing max position = 6)
-- ---------------------------------------------------------------------
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  'a99f21b3-9a29-49ef-aec1-4017d4836408', 7, 2200,
  'Next rep — defenders read the overlap and intercept the release pass. Same drill, different outcome as different players take their turn.',
  $JSON$[
    {"id":"p1","type":"player","label":"A","color":"#0ea5e9","x":50,"y":52},
    {"id":"p2","type":"player","label":"B","color":"#0ea5e9","x":35,"y":48},
    {"id":"p3","type":"player","label":"D1","color":"#ef4444","x":52,"y":48},
    {"id":"p4","type":"player","label":"D2","color":"#ef4444","x":40,"y":42},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":42,"y":44},
    {"id":"w1","type":"player","label":"W1","color":"#94a3b8","x":34,"y":90},
    {"id":"w2","type":"player","label":"W2","color":"#94a3b8","x":42,"y":90},
    {"id":"w3","type":"player","label":"W3","color":"#94a3b8","x":58,"y":90},
    {"id":"w4","type":"player","label":"W4","color":"#94a3b8","x":66,"y":90},
    {"id":"g1","type":"mini-goal","x":50,"y":10}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":40,"y":42},"to":{"x":42,"y":44}}},
    {"id":"t1","type":"text","geometry":{"text":"Outcomes vary — same drill, different players","x":50,"y":62}}
  ]$JSON$::jsonb
);

INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  'a99f21b3-9a29-49ef-aec1-4017d4836408', 8, 2200,
  'D2 cuts out the overlap pass and clears upfield. All four jog back — next group in.',
  $JSON$[
    {"id":"p1","type":"player","label":"A","color":"#0ea5e9","x":50,"y":55},
    {"id":"p2","type":"player","label":"B","color":"#0ea5e9","x":35,"y":50},
    {"id":"p3","type":"player","label":"D1","color":"#ef4444","x":52,"y":48},
    {"id":"p4","type":"player","label":"D2","color":"#ef4444","x":40,"y":42},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":30,"y":75},
    {"id":"w1","type":"player","label":"W1","color":"#94a3b8","x":34,"y":90},
    {"id":"w2","type":"player","label":"W2","color":"#94a3b8","x":42,"y":90},
    {"id":"w3","type":"player","label":"W3","color":"#94a3b8","x":58,"y":90},
    {"id":"w4","type":"player","label":"W4","color":"#94a3b8","x":66,"y":90},
    {"id":"g1","type":"mini-goal","x":50,"y":10}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":40,"y":42},"to":{"x":30,"y":75}}},
    {"id":"t1","type":"text","geometry":{"text":"Defenders clear — next group in","x":50,"y":30}}
  ]$JSON$::jsonb
);