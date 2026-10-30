
-- =====================================================================
-- Append a "rotation" frame to every official drill with waiting players.
-- Frame teaches: actives walk to the back of the line, w1/w2 step up to
-- the active starting spots. Arrows visualise the rotation.
-- =====================================================================

-- 1v1 attack with feint  (position 5)  -- p1=A on ball at y=75, p2=D at y=35; w1,w2 at y=90
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  'a015a46c-1380-4433-b149-87da1434a839', 5, 2000,
  'Rotation — A and D jog to the back of the line; W1 steps up as new attacker on the ball, W2 takes the defender spot. Next pair go.',
  $JSON$[
    {"id":"p1","type":"player","label":"A","color":"#94a3b8","x":38,"y":90},
    {"id":"p2","type":"player","label":"D","color":"#94a3b8","x":62,"y":90},
    {"id":"w1","type":"player","label":"W1","color":"#0ea5e9","x":50,"y":75},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":76},
    {"id":"w2","type":"player","label":"W2","color":"#ef4444","x":50,"y":35},
    {"id":"c1","type":"cone","color":"#f97316","x":30,"y":20},
    {"id":"c2","type":"cone","color":"#f97316","x":70,"y":20},
    {"id":"c3","type":"cone","color":"#f97316","x":30,"y":85},
    {"id":"c4","type":"cone","color":"#f97316","x":70,"y":85},
    {"id":"g1","type":"mini-goal","x":50,"y":10}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"r1","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":60,"y":25},"to":{"x":38,"y":88}}},
    {"id":"r2","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":45,"y":35},"to":{"x":62,"y":88}}},
    {"id":"r3","type":"arrow-solid","style":{"color":"#0ea5e9"},"geometry":{"from":{"x":46,"y":88},"to":{"x":50,"y":76}}},
    {"id":"r4","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":54,"y":88},"to":{"x":50,"y":37}}},
    {"id":"r-text","type":"text","geometry":{"text":"Rotate — Next pair in","x":50,"y":58}}
  ]$JSON$::jsonb
);

-- 1v1 defending channel  (position 5)  -- p1=A red on ball y=20, p2=D blue at y=80; w1,w2
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '3b67d29e-507e-4432-b20b-91805ffdc825', 5, 2000,
  'Rotation — Attacker and defender jog out to the back of the line; W1 becomes new attacker on the ball, W2 the new defender.',
  $JSON$[
    {"id":"p1","type":"player","label":"A","color":"#94a3b8","x":38,"y":90},
    {"id":"p2","type":"player","label":"D","color":"#94a3b8","x":62,"y":90},
    {"id":"w1","type":"player","label":"W1","color":"#ef4444","x":50,"y":20},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":21},
    {"id":"w2","type":"player","label":"W2","color":"#0ea5e9","x":50,"y":80},
    {"id":"c1","type":"cone","color":"#f97316","x":30,"y":15},
    {"id":"c2","type":"cone","color":"#f97316","x":70,"y":15},
    {"id":"c3","type":"cone","color":"#f97316","x":30,"y":85},
    {"id":"c4","type":"cone","color":"#f97316","x":70,"y":85},
    {"id":"g1","type":"mini-goal","x":50,"y":90}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"r1","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":33,"y":70},"to":{"x":38,"y":88}}},
    {"id":"r2","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":40,"y":70},"to":{"x":62,"y":88}}},
    {"id":"r3","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":46,"y":88},"to":{"x":50,"y":22}}},
    {"id":"r4","type":"arrow-solid","style":{"color":"#0ea5e9"},"geometry":{"from":{"x":54,"y":88},"to":{"x":50,"y":78}}},
    {"id":"r-text","type":"text","geometry":{"text":"Rotate — Next pair in","x":50,"y":50}}
  ]$JSON$::jsonb
);

-- 1v1 to end-zone  (position 5)  -- p1=A blue, p2=D red, w1-w4
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '2f7f91d0-5526-42f9-a6c7-c9fb931eeb1e', 5, 2000,
  'Rotation — A and D jog to the back of the queue; W1 steps in as attacker on the ball, W2 as defender. W3 and W4 shuffle forward in the line.',
  $JSON$[
    {"id":"p1","type":"player","label":"A","color":"#94a3b8","x":38,"y":90},
    {"id":"p2","type":"player","label":"D","color":"#94a3b8","x":46,"y":90},
    {"id":"w3","type":"player","label":"W3","color":"#94a3b8","x":54,"y":90},
    {"id":"w4","type":"player","label":"W4","color":"#94a3b8","x":62,"y":90},
    {"id":"w1","type":"player","label":"W1","color":"#0ea5e9","x":50,"y":80},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":81},
    {"id":"w2","type":"player","label":"W2","color":"#ef4444","x":50,"y":25},
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
    {"id":"r1","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":40,"y":18},"to":{"x":38,"y":88}}},
    {"id":"r2","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":55,"y":30},"to":{"x":46,"y":88}}},
    {"id":"r3","type":"arrow-solid","style":{"color":"#0ea5e9"},"geometry":{"from":{"x":38,"y":88},"to":{"x":50,"y":80}}},
    {"id":"r4","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":46,"y":88},"to":{"x":50,"y":27}}},
    {"id":"r-text","type":"text","geometry":{"text":"Rotate — W1 attack, W2 defend","x":50,"y":55}}
  ]$JSON$::jsonb
);

-- 1v1 to mini-goals  (position 5)  -- p1=A blue, p2=D red, two mini goals top/bottom
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '1803b2b8-005b-4a7f-9c18-50579f3fa972', 5, 2000,
  'Rotation — Active pair jogs back to the line; W1 and W2 step up to the centre, ball between them — the next 1v1 starts on the coach''s whistle.',
  $JSON$[
    {"id":"p1","type":"player","label":"A","color":"#94a3b8","x":38,"y":90},
    {"id":"p2","type":"player","label":"D","color":"#94a3b8","x":62,"y":90},
    {"id":"w1","type":"player","label":"W1","color":"#0ea5e9","x":45,"y":50},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":50},
    {"id":"w2","type":"player","label":"W2","color":"#ef4444","x":55,"y":50},
    {"id":"g1","type":"mini-goal","x":50,"y":10},
    {"id":"g2","type":"mini-goal","x":50,"y":90}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"r1","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":35,"y":18},"to":{"x":38,"y":88}}},
    {"id":"r2","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":48,"y":28},"to":{"x":62,"y":88}}},
    {"id":"r3","type":"arrow-solid","style":{"color":"#0ea5e9"},"geometry":{"from":{"x":46,"y":88},"to":{"x":45,"y":52}}},
    {"id":"r4","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":54,"y":88},"to":{"x":55,"y":52}}},
    {"id":"r-text","type":"text","geometry":{"text":"Rotate — Next pair in","x":50,"y":68}}
  ]$JSON$::jsonb
);

-- 1v1 with overlap option  (position 5)  -- p1=A1, p2=A2, p3=D1, p4=D2; w1-w4
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  'a99f21b3-9a29-49ef-aec1-4017d4836408', 5, 2000,
  'Rotation — All four jog back to the queue; W1 and W2 step in as the new attacking pair (W1 on the ball), W3 and W4 set up as defenders.',
  $JSON$[
    {"id":"p1","type":"player","label":"A1","color":"#94a3b8","x":34,"y":90},
    {"id":"p2","type":"player","label":"A2","color":"#94a3b8","x":42,"y":90},
    {"id":"p3","type":"player","label":"D1","color":"#94a3b8","x":58,"y":90},
    {"id":"p4","type":"player","label":"D2","color":"#94a3b8","x":66,"y":90},
    {"id":"w1","type":"player","label":"W1","color":"#0ea5e9","x":50,"y":75},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":76},
    {"id":"w2","type":"player","label":"W2","color":"#0ea5e9","x":75,"y":70},
    {"id":"w3","type":"player","label":"W3","color":"#ef4444","x":50,"y":50},
    {"id":"w4","type":"player","label":"W4","color":"#ef4444","x":50,"y":25},
    {"id":"g1","type":"mini-goal","x":50,"y":10}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"r1","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":48,"y":55},"to":{"x":34,"y":88}}},
    {"id":"r2","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":65,"y":20},"to":{"x":42,"y":88}}},
    {"id":"r3","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":47,"y":47},"to":{"x":58,"y":88}}},
    {"id":"r4","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":55,"y":25},"to":{"x":66,"y":88}}},
    {"id":"r5","type":"arrow-solid","style":{"color":"#0ea5e9"},"geometry":{"from":{"x":38,"y":88},"to":{"x":50,"y":76}}},
    {"id":"r6","type":"arrow-solid","style":{"color":"#0ea5e9"},"geometry":{"from":{"x":46,"y":88},"to":{"x":75,"y":71}}},
    {"id":"r7","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":54,"y":88},"to":{"x":50,"y":52}}},
    {"id":"r8","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":62,"y":88},"to":{"x":50,"y":27}}},
    {"id":"r-text","type":"text","geometry":{"text":"Rotate — New 2v2 group in","x":50,"y":40}}
  ]$JSON$::jsonb
);

-- Check-away to receive  (position 5)  -- p1=S server, p2=R receiver, p3=D, w1
-- Single waiting player → R rotates to the back, D becomes R, S becomes D, W1 becomes S.
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '7af08c88-bc92-4dee-a21c-6a4fb0e34ab7', 5, 2000,
  'Rotation — Receiver returns to the back of the line; defender steps up as new receiver, server becomes the new defender, W1 collects the ball as new server.',
  $JSON$[
    {"id":"p2","type":"player","label":"R","color":"#94a3b8","x":50,"y":90},
    {"id":"w1","type":"player","label":"S","color":"#0ea5e9","x":50,"y":80},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":81},
    {"id":"p1","type":"player","label":"D","color":"#ef4444","x":50,"y":32},
    {"id":"p3","type":"player","label":"R","color":"#0ea5e9","x":50,"y":40}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"r1","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":65,"y":55},"to":{"x":50,"y":88}}},
    {"id":"r2","type":"arrow-solid","style":{"color":"#0ea5e9"},"geometry":{"from":{"x":50,"y":35},"to":{"x":50,"y":40}}},
    {"id":"r3","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":50,"y":78},"to":{"x":50,"y":34}}},
    {"id":"r4","type":"arrow-solid","style":{"color":"#0ea5e9"},"geometry":{"from":{"x":50,"y":88},"to":{"x":50,"y":82}}},
    {"id":"r-text","type":"text","geometry":{"text":"Rotate — R → back, D → R, S → D","x":50,"y":62}}
  ]$JSON$::jsonb
);

-- Cone slalom dribble  (position 6)  -- already has 6 frames (0-5). p1=A, w1-w7 vertical line on right.
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  'cf4a5eab-e2af-4186-ac25-54a599c721fe', 6, 2000,
  'Rotation — Player jogs across to the back of the queue with the ball; W1 sprints in to start the slalom from the bottom cone. Queue shuffles up.',
  $JSON$[
    {"id":"p1","type":"player","label":"A","color":"#94a3b8","x":90,"y":74},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":90,"y":75},
    {"id":"w1","type":"player","label":"W1","color":"#0ea5e9","x":50,"y":88},
    {"id":"w2","type":"player","label":"W2","color":"#94a3b8","x":90,"y":26},
    {"id":"w3","type":"player","label":"W3","color":"#94a3b8","x":90,"y":34},
    {"id":"w4","type":"player","label":"W4","color":"#94a3b8","x":90,"y":42},
    {"id":"w5","type":"player","label":"W5","color":"#94a3b8","x":90,"y":50},
    {"id":"w6","type":"player","label":"W6","color":"#94a3b8","x":90,"y":58},
    {"id":"w7","type":"player","label":"W7","color":"#94a3b8","x":90,"y":66},
    {"id":"c0","type":"cone","color":"#f97316","x":50,"y":80},
    {"id":"c1","type":"cone","color":"#f97316","x":50,"y":68},
    {"id":"c2","type":"cone","color":"#f97316","x":50,"y":56},
    {"id":"c3","type":"cone","color":"#f97316","x":50,"y":44},
    {"id":"c4","type":"cone","color":"#f97316","x":50,"y":32},
    {"id":"c5","type":"cone","color":"#f97316","x":50,"y":20}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"r1","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":50,"y":15},"to":{"x":90,"y":72}}},
    {"id":"r2","type":"arrow-solid","style":{"color":"#0ea5e9"},"geometry":{"from":{"x":90,"y":26},"to":{"x":50,"y":88}}},
    {"id":"r-text","type":"text","geometry":{"text":"Rotate — W1 starts the slalom","x":50,"y":15}}
  ]$JSON$::jsonb
);

-- Cool-down circle  (position 5)  -- coach C in centre, players around circle, w1-w5 sit out
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '82161da0-5fb3-46c9-826d-1e8ee3b350b2', 5, 2500,
  'Rotation — Coach swaps places with W1 so a player leads the next stretch; W2-W5 join the circle, the original 6 step out for a sip of water.',
  $JSON$[
    {"id":"pc","type":"player","label":"C","color":"#94a3b8","x":34,"y":90},
    {"id":"p0","type":"player","label":"1","color":"#94a3b8","x":42,"y":90},
    {"id":"p1","type":"player","label":"2","color":"#94a3b8","x":50,"y":90},
    {"id":"p2","type":"player","label":"3","color":"#94a3b8","x":58,"y":90},
    {"id":"p3","type":"player","label":"4","color":"#94a3b8","x":66,"y":90},
    {"id":"p4","type":"player","label":"5","color":"#94a3b8","x":74,"y":90},
    {"id":"p5","type":"player","label":"6","color":"#94a3b8","x":82,"y":90},
    {"id":"w1","type":"player","label":"W1","color":"#22c55e","x":50,"y":50},
    {"id":"w2","type":"player","label":"W2","color":"#0ea5e9","x":75,"y":50},
    {"id":"w3","type":"player","label":"W3","color":"#0ea5e9","x":62.5,"y":71.65},
    {"id":"w4","type":"player","label":"W4","color":"#0ea5e9","x":37.5,"y":71.65},
    {"id":"w5","type":"player","label":"W5","color":"#0ea5e9","x":25,"y":50}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"r1","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":50,"y":50},"to":{"x":34,"y":88}}},
    {"id":"r2","type":"arrow-solid","style":{"color":"#22c55e"},"geometry":{"from":{"x":34,"y":88},"to":{"x":50,"y":52}}},
    {"id":"r3","type":"arrow-solid","style":{"color":"#0ea5e9"},"geometry":{"from":{"x":42,"y":88},"to":{"x":75,"y":52}}},
    {"id":"r4","type":"arrow-solid","style":{"color":"#0ea5e9"},"geometry":{"from":{"x":50,"y":88},"to":{"x":62,"y":71}}},
    {"id":"r5","type":"arrow-solid","style":{"color":"#0ea5e9"},"geometry":{"from":{"x":58,"y":88},"to":{"x":38,"y":71}}},
    {"id":"r6","type":"arrow-solid","style":{"color":"#0ea5e9"},"geometry":{"from":{"x":66,"y":88},"to":{"x":26,"y":52}}},
    {"id":"r-text","type":"text","geometry":{"text":"Rotate — fresh circle, W1 leads","x":50,"y":20}}
  ]$JSON$::jsonb
);

-- Dribble gates  (position 6)  -- already has 6 frames. p1=A, w1-w7 vertical line on right.
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '2c33666b-a71e-4bb2-8e47-8275c695ed75', 6, 2000,
  'Rotation — Player jogs back to the queue with the ball; W1 sprints in to the start cone and begins picking gates. Queue shuffles up.',
  $JSON$[
    {"id":"p1","type":"player","label":"A","color":"#94a3b8","x":90,"y":74},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":90,"y":75},
    {"id":"w1","type":"player","label":"W1","color":"#0ea5e9","x":50,"y":88},
    {"id":"w2","type":"player","label":"W2","color":"#94a3b8","x":90,"y":26},
    {"id":"w3","type":"player","label":"W3","color":"#94a3b8","x":90,"y":34},
    {"id":"w4","type":"player","label":"W4","color":"#94a3b8","x":90,"y":42},
    {"id":"w5","type":"player","label":"W5","color":"#94a3b8","x":90,"y":50},
    {"id":"w6","type":"player","label":"W6","color":"#94a3b8","x":90,"y":58},
    {"id":"w7","type":"player","label":"W7","color":"#94a3b8","x":90,"y":66},
    {"id":"c1","type":"cone","color":"#f97316","x":30,"y":70},
    {"id":"c2","type":"cone","color":"#f97316","x":40,"y":70},
    {"id":"c3","type":"cone","color":"#f97316","x":60,"y":60},
    {"id":"c4","type":"cone","color":"#f97316","x":70,"y":60},
    {"id":"c5","type":"cone","color":"#f97316","x":30,"y":45},
    {"id":"c6","type":"cone","color":"#f97316","x":40,"y":45},
    {"id":"c7","type":"cone","color":"#f97316","x":60,"y":30},
    {"id":"c8","type":"cone","color":"#f97316","x":70,"y":30}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"r1","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":65,"y":20},"to":{"x":90,"y":72}}},
    {"id":"r2","type":"arrow-solid","style":{"color":"#0ea5e9"},"geometry":{"from":{"x":90,"y":26},"to":{"x":50,"y":88}}},
    {"id":"r-text","type":"text","geometry":{"text":"Rotate — W1 attacks the gates","x":50,"y":15}}
  ]$JSON$::jsonb
);
