
-- =====================================================================
-- Cycle rotations: append further frames so the rotation keeps going
-- through every waiting player, not just the first swap.
-- All "off-pitch" tokens stay greyed (#94a3b8) until they cycle in.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1v1 attack with feint  — pos 5 = first rotation. Add pos 6: the
-- previous active pair (now at back) sits while the original Wn pair
-- finishes — and we show the original pair stepping back in (only 2
-- waiting tokens, so cycle is 2-deep).
-- ---------------------------------------------------------------------
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  'a015a46c-1380-4433-b149-87da1434a839', 6, 2000,
  'Rotation cont. — W1 and W2 finish their rep and jog back; original A and D step up to the start spots. Cycle keeps going every rep.',
  $JSON$[
    {"id":"w1","type":"player","label":"W1","color":"#94a3b8","x":38,"y":90},
    {"id":"w2","type":"player","label":"W2","color":"#94a3b8","x":62,"y":90},
    {"id":"p1","type":"player","label":"A","color":"#0ea5e9","x":50,"y":75},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":76},
    {"id":"p2","type":"player","label":"D","color":"#ef4444","x":50,"y":35},
    {"id":"c1","type":"cone","color":"#f97316","x":30,"y":20},
    {"id":"c2","type":"cone","color":"#f97316","x":70,"y":20},
    {"id":"c3","type":"cone","color":"#f97316","x":30,"y":85},
    {"id":"c4","type":"cone","color":"#f97316","x":70,"y":85},
    {"id":"g1","type":"mini-goal","x":50,"y":10}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"r1","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":50,"y":75},"to":{"x":38,"y":88}}},
    {"id":"r2","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":50,"y":35},"to":{"x":62,"y":88}}},
    {"id":"r3","type":"arrow-solid","style":{"color":"#0ea5e9"},"geometry":{"from":{"x":38,"y":88},"to":{"x":50,"y":76}}},
    {"id":"r4","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":62,"y":88},"to":{"x":50,"y":37}}},
    {"id":"r-text","type":"text","geometry":{"text":"Cycle continues — every pair gets a turn","x":50,"y":58}}
  ]$JSON$::jsonb
);

-- ---------------------------------------------------------------------
-- 1v1 defending channel — same 2-player cycle.
-- ---------------------------------------------------------------------
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '3b67d29e-507e-4432-b20b-91805ffdc825', 6, 2000,
  'Rotation cont. — W1 and W2 finish and jog back; original A and D return to the start. Cycle repeats every rep.',
  $JSON$[
    {"id":"w1","type":"player","label":"W1","color":"#94a3b8","x":38,"y":90},
    {"id":"w2","type":"player","label":"W2","color":"#94a3b8","x":62,"y":90},
    {"id":"p1","type":"player","label":"A","color":"#ef4444","x":50,"y":20},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":21},
    {"id":"p2","type":"player","label":"D","color":"#0ea5e9","x":50,"y":80},
    {"id":"c1","type":"cone","color":"#f97316","x":30,"y":15},
    {"id":"c2","type":"cone","color":"#f97316","x":70,"y":15},
    {"id":"c3","type":"cone","color":"#f97316","x":30,"y":85},
    {"id":"c4","type":"cone","color":"#f97316","x":70,"y":85},
    {"id":"g1","type":"mini-goal","x":50,"y":90}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"r1","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":50,"y":20},"to":{"x":38,"y":88}}},
    {"id":"r2","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":50,"y":80},"to":{"x":62,"y":88}}},
    {"id":"r3","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":46,"y":88},"to":{"x":50,"y":22}}},
    {"id":"r4","type":"arrow-solid","style":{"color":"#0ea5e9"},"geometry":{"from":{"x":54,"y":88},"to":{"x":50,"y":78}}},
    {"id":"r-text","type":"text","geometry":{"text":"Cycle continues — every pair gets a turn","x":50,"y":50}}
  ]$JSON$::jsonb
);

-- ---------------------------------------------------------------------
-- 1v1 to mini-goals — 2 waiting → 2-deep cycle.
-- ---------------------------------------------------------------------
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '1803b2b8-005b-4a7f-9c18-50579f3fa972', 6, 2000,
  'Rotation cont. — W1 and W2 jog back to the line; original A and D return to the centre with the ball for the next rep.',
  $JSON$[
    {"id":"w1","type":"player","label":"W1","color":"#94a3b8","x":38,"y":90},
    {"id":"w2","type":"player","label":"W2","color":"#94a3b8","x":62,"y":90},
    {"id":"p1","type":"player","label":"A","color":"#0ea5e9","x":45,"y":50},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":50},
    {"id":"p2","type":"player","label":"D","color":"#ef4444","x":55,"y":50},
    {"id":"g1","type":"mini-goal","x":50,"y":10},
    {"id":"g2","type":"mini-goal","x":50,"y":90}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"r1","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":45,"y":50},"to":{"x":38,"y":88}}},
    {"id":"r2","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":55,"y":50},"to":{"x":62,"y":88}}},
    {"id":"r3","type":"arrow-solid","style":{"color":"#0ea5e9"},"geometry":{"from":{"x":38,"y":88},"to":{"x":45,"y":52}}},
    {"id":"r4","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":62,"y":88},"to":{"x":55,"y":52}}},
    {"id":"r-text","type":"text","geometry":{"text":"Cycle continues — every pair gets a turn","x":50,"y":68}}
  ]$JSON$::jsonb
);

-- ---------------------------------------------------------------------
-- Check-away to receive — 4-way cycle (S, R, D, W1) → 3 cycle frames
-- so every player has a turn at receiver. After existing pos 5 we show
-- pos 6 and pos 7.
-- After pos 5: p2(R)→back, w1=S, p1=D, p3=R
-- pos 6: previous p3 cycles to back, w1 becomes D, p1 becomes S? Simpler:
-- show ORIGINAL p1 back as receiver to demonstrate cycle completion.
-- ---------------------------------------------------------------------
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '7af08c88-bc92-4dee-a21c-6a4fb0e34ab7', 6, 2000,
  'Rotation cont. — W1 (now serving) finishes the feed; receiver jogs back, server steps up as new receiver, W1 becomes defender, original receiver re-enters as server.',
  $JSON$[
    {"id":"p3","type":"player","label":"R","color":"#94a3b8","x":50,"y":90},
    {"id":"p2","type":"player","label":"S","color":"#0ea5e9","x":50,"y":80},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":81},
    {"id":"w1","type":"player","label":"D","color":"#ef4444","x":50,"y":32},
    {"id":"p1","type":"player","label":"R","color":"#0ea5e9","x":50,"y":40}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"r1","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":50,"y":40},"to":{"x":50,"y":88}}},
    {"id":"r-text","type":"text","geometry":{"text":"Cycle continues — every player rotates through R, D, S","x":50,"y":62}}
  ]$JSON$::jsonb
);

INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '7af08c88-bc92-4dee-a21c-6a4fb0e34ab7', 7, 2000,
  'Rotation cont. — Cycle returns to the start: original server (p1) is back on the ball as S, ready for the next rep with a fresh receiver.',
  $JSON$[
    {"id":"w1","type":"player","label":"W1","color":"#94a3b8","x":50,"y":90},
    {"id":"p1","type":"player","label":"S","color":"#0ea5e9","x":50,"y":80},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":81},
    {"id":"p2","type":"player","label":"R","color":"#0ea5e9","x":50,"y":40},
    {"id":"p3","type":"player","label":"D","color":"#ef4444","x":50,"y":32}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"r-text","type":"text","geometry":{"text":"Back to start — drill loops","x":50,"y":62}}
  ]$JSON$::jsonb
);

-- ---------------------------------------------------------------------
-- 1v1 to end-zone — 6 players (A, D, w1-w4). 2 more cycle frames so
-- every pair (W1+W2, W3+W4, original A+D) gets a turn.
-- pos 5 was: p1,p2 → back; w1 = attacker; w2 = defender. (w3, w4 still grey)
-- pos 6: w1, w2 finish → back; w3 = attacker; w4 = defender.
-- pos 7: w3, w4 finish → back; original p1, p2 return as A, D.
-- ---------------------------------------------------------------------
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '2f7f91d0-5526-42f9-a6c7-c9fb931eeb1e', 6, 2000,
  'Rotation cont. — W1 and W2 jog back; W3 steps up as attacker on the ball, W4 as defender. p1 and p2 still wait at the back.',
  $JSON$[
    {"id":"p1","type":"player","label":"A","color":"#94a3b8","x":38,"y":90},
    {"id":"p2","type":"player","label":"D","color":"#94a3b8","x":46,"y":90},
    {"id":"w1","type":"player","label":"W1","color":"#94a3b8","x":54,"y":90},
    {"id":"w2","type":"player","label":"W2","color":"#94a3b8","x":62,"y":90},
    {"id":"w3","type":"player","label":"W3","color":"#0ea5e9","x":50,"y":80},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":81},
    {"id":"w4","type":"player","label":"W4","color":"#ef4444","x":50,"y":25},
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
    {"id":"r1","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":50,"y":80},"to":{"x":54,"y":88}}},
    {"id":"r2","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":50,"y":25},"to":{"x":62,"y":88}}},
    {"id":"r3","type":"arrow-solid","style":{"color":"#0ea5e9"},"geometry":{"from":{"x":54,"y":88},"to":{"x":50,"y":80}}},
    {"id":"r4","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":62,"y":88},"to":{"x":50,"y":27}}},
    {"id":"r-text","type":"text","geometry":{"text":"Cycle continues — W3 attack, W4 defend","x":50,"y":55}}
  ]$JSON$::jsonb
);

INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '2f7f91d0-5526-42f9-a6c7-c9fb931eeb1e', 7, 2000,
  'Rotation cont. — W3 and W4 jog back; original A and D return to the start. Full cycle complete — every player has had a turn.',
  $JSON$[
    {"id":"w3","type":"player","label":"W3","color":"#94a3b8","x":54,"y":90},
    {"id":"w4","type":"player","label":"W4","color":"#94a3b8","x":62,"y":90},
    {"id":"w1","type":"player","label":"W1","color":"#94a3b8","x":38,"y":90},
    {"id":"w2","type":"player","label":"W2","color":"#94a3b8","x":46,"y":90},
    {"id":"p1","type":"player","label":"A","color":"#0ea5e9","x":50,"y":80},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":81},
    {"id":"p2","type":"player","label":"D","color":"#ef4444","x":50,"y":25},
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
    {"id":"r-text","type":"text","geometry":{"text":"Back to start — drill loops","x":50,"y":55}}
  ]$JSON$::jsonb
);

-- ---------------------------------------------------------------------
-- 1v1 with overlap option — 8 players (A1, A2, D1, D2, w1-w4).
-- pos 5: actives → back; w1+w2 attackers, w3+w4 defenders. Add pos 6
-- showing original 4 cycling back in.
-- ---------------------------------------------------------------------
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  'a99f21b3-9a29-49ef-aec1-4017d4836408', 6, 2000,
  'Rotation cont. — W1-W4 finish and jog back; original A1, A2, D1, D2 return to the start positions. Cycle repeats so every group of four gets a rep.',
  $JSON$[
    {"id":"w1","type":"player","label":"W1","color":"#94a3b8","x":34,"y":90},
    {"id":"w2","type":"player","label":"W2","color":"#94a3b8","x":42,"y":90},
    {"id":"w3","type":"player","label":"W3","color":"#94a3b8","x":58,"y":90},
    {"id":"w4","type":"player","label":"W4","color":"#94a3b8","x":66,"y":90},
    {"id":"p1","type":"player","label":"A1","color":"#0ea5e9","x":50,"y":75},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":76},
    {"id":"p2","type":"player","label":"A2","color":"#0ea5e9","x":75,"y":70},
    {"id":"p3","type":"player","label":"D1","color":"#ef4444","x":50,"y":50},
    {"id":"p4","type":"player","label":"D2","color":"#ef4444","x":50,"y":25},
    {"id":"g1","type":"mini-goal","x":50,"y":10}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"r1","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":50,"y":75},"to":{"x":34,"y":88}}},
    {"id":"r2","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":75,"y":70},"to":{"x":42,"y":88}}},
    {"id":"r3","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":50,"y":50},"to":{"x":58,"y":88}}},
    {"id":"r4","type":"arrow-dashed","style":{"color":"#94a3b8"},"geometry":{"from":{"x":50,"y":25},"to":{"x":66,"y":88}}},
    {"id":"r-text","type":"text","geometry":{"text":"Cycle continues — every group of 4 gets a rep","x":50,"y":40}}
  ]$JSON$::jsonb
);

-- ---------------------------------------------------------------------
-- Cone slalom dribble — 8 total (A + 7 waiting). Show 2 more cycles
-- so every name appears as the active dribbler.
-- pos 6 already: A → back at y=74 spot, w1 = A, others grey.
-- pos 7: w1 → back, w2 = A.
-- pos 8: w2 → back, w3 = A. (Pattern is clear; remaining w4-w7 + p1
-- inferred — keeps frame count manageable.)
-- ---------------------------------------------------------------------
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  'cf4a5eab-e2af-4186-ac25-54a599c721fe', 7, 2000,
  'Rotation cont. — W1 finishes and joins the back of the queue; W2 sprints in to start the slalom. Queue keeps shuffling up.',
  $JSON$[
    {"id":"w1","type":"player","label":"W1","color":"#94a3b8","x":90,"y":74},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":90,"y":75},
    {"id":"w2","type":"player","label":"W2","color":"#0ea5e9","x":50,"y":88},
    {"id":"p1","type":"player","label":"A","color":"#94a3b8","x":90,"y":18},
    {"id":"w3","type":"player","label":"W3","color":"#94a3b8","x":90,"y":26},
    {"id":"w4","type":"player","label":"W4","color":"#94a3b8","x":90,"y":34},
    {"id":"w5","type":"player","label":"W5","color":"#94a3b8","x":90,"y":42},
    {"id":"w6","type":"player","label":"W6","color":"#94a3b8","x":90,"y":50},
    {"id":"w7","type":"player","label":"W7","color":"#94a3b8","x":90,"y":58},
    {"id":"c0","type":"cone","color":"#f97316","x":50,"y":80},
    {"id":"c1","type":"cone","color":"#f97316","x":50,"y":68},
    {"id":"c2","type":"cone","color":"#f97316","x":50,"y":56},
    {"id":"c3","type":"cone","color":"#f97316","x":50,"y":44},
    {"id":"c4","type":"cone","color":"#f97316","x":50,"y":32},
    {"id":"c5","type":"cone","color":"#f97316","x":50,"y":20}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"r1","type":"arrow-solid","style":{"color":"#0ea5e9"},"geometry":{"from":{"x":90,"y":34},"to":{"x":50,"y":88}}},
    {"id":"r-text","type":"text","geometry":{"text":"Cycle — W2 starts","x":50,"y":15}}
  ]$JSON$::jsonb
);

INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  'cf4a5eab-e2af-4186-ac25-54a599c721fe', 8, 2000,
  'Rotation cont. — W2 finishes; W3 starts the slalom. Pattern continues until every player has had a rep, then loops back to A.',
  $JSON$[
    {"id":"w2","type":"player","label":"W2","color":"#94a3b8","x":90,"y":74},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":90,"y":75},
    {"id":"w3","type":"player","label":"W3","color":"#0ea5e9","x":50,"y":88},
    {"id":"p1","type":"player","label":"A","color":"#94a3b8","x":90,"y":18},
    {"id":"w1","type":"player","label":"W1","color":"#94a3b8","x":90,"y":26},
    {"id":"w4","type":"player","label":"W4","color":"#94a3b8","x":90,"y":34},
    {"id":"w5","type":"player","label":"W5","color":"#94a3b8","x":90,"y":42},
    {"id":"w6","type":"player","label":"W6","color":"#94a3b8","x":90,"y":50},
    {"id":"w7","type":"player","label":"W7","color":"#94a3b8","x":90,"y":58},
    {"id":"c0","type":"cone","color":"#f97316","x":50,"y":80},
    {"id":"c1","type":"cone","color":"#f97316","x":50,"y":68},
    {"id":"c2","type":"cone","color":"#f97316","x":50,"y":56},
    {"id":"c3","type":"cone","color":"#f97316","x":50,"y":44},
    {"id":"c4","type":"cone","color":"#f97316","x":50,"y":32},
    {"id":"c5","type":"cone","color":"#f97316","x":50,"y":20}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"r1","type":"arrow-solid","style":{"color":"#0ea5e9"},"geometry":{"from":{"x":90,"y":34},"to":{"x":50,"y":88}}},
    {"id":"r-text","type":"text","geometry":{"text":"Cycle — W3 starts, every player gets a rep","x":50,"y":15}}
  ]$JSON$::jsonb
);

-- ---------------------------------------------------------------------
-- Dribble gates — same single-line cycle as cone slalom.
-- ---------------------------------------------------------------------
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '2c33666b-a71e-4bb2-8e47-8275c695ed75', 7, 2000,
  'Rotation cont. — W1 finishes and joins the back; W2 attacks the gates next.',
  $JSON$[
    {"id":"w1","type":"player","label":"W1","color":"#94a3b8","x":90,"y":74},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":90,"y":75},
    {"id":"w2","type":"player","label":"W2","color":"#0ea5e9","x":50,"y":88},
    {"id":"p1","type":"player","label":"A","color":"#94a3b8","x":90,"y":18},
    {"id":"w3","type":"player","label":"W3","color":"#94a3b8","x":90,"y":26},
    {"id":"w4","type":"player","label":"W4","color":"#94a3b8","x":90,"y":34},
    {"id":"w5","type":"player","label":"W5","color":"#94a3b8","x":90,"y":42},
    {"id":"w6","type":"player","label":"W6","color":"#94a3b8","x":90,"y":50},
    {"id":"w7","type":"player","label":"W7","color":"#94a3b8","x":90,"y":58},
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
    {"id":"r1","type":"arrow-solid","style":{"color":"#0ea5e9"},"geometry":{"from":{"x":90,"y":34},"to":{"x":50,"y":88}}},
    {"id":"r-text","type":"text","geometry":{"text":"Cycle — W2 attacks the gates","x":50,"y":15}}
  ]$JSON$::jsonb
);

INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '2c33666b-a71e-4bb2-8e47-8275c695ed75', 8, 2000,
  'Rotation cont. — W2 finishes; W3 starts. Keep cycling so every player picks gates.',
  $JSON$[
    {"id":"w2","type":"player","label":"W2","color":"#94a3b8","x":90,"y":74},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":90,"y":75},
    {"id":"w3","type":"player","label":"W3","color":"#0ea5e9","x":50,"y":88},
    {"id":"p1","type":"player","label":"A","color":"#94a3b8","x":90,"y":18},
    {"id":"w1","type":"player","label":"W1","color":"#94a3b8","x":90,"y":26},
    {"id":"w4","type":"player","label":"W4","color":"#94a3b8","x":90,"y":34},
    {"id":"w5","type":"player","label":"W5","color":"#94a3b8","x":90,"y":42},
    {"id":"w6","type":"player","label":"W6","color":"#94a3b8","x":90,"y":50},
    {"id":"w7","type":"player","label":"W7","color":"#94a3b8","x":90,"y":58},
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
    {"id":"r1","type":"arrow-solid","style":{"color":"#0ea5e9"},"geometry":{"from":{"x":90,"y":34},"to":{"x":50,"y":88}}},
    {"id":"r-text","type":"text","geometry":{"text":"Cycle — W3 attacks, every player gets a rep","x":50,"y":15}}
  ]$JSON$::jsonb
);

-- ---------------------------------------------------------------------
-- Cool-down circle — fresh circle from W1-W5 + previous coach in middle.
-- Add pos 6: original group + new coach (W2) lead next stretch.
-- ---------------------------------------------------------------------
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '82161da0-5fb3-46c9-826d-1e8ee3b350b2', 6, 2500,
  'Rotation cont. — Fresh circle reforms with the original players; W2 takes the centre to lead the next stretch. Everyone gets a turn leading.',
  $JSON$[
    {"id":"w1","type":"player","label":"W1","color":"#94a3b8","x":34,"y":90},
    {"id":"w3","type":"player","label":"W3","color":"#94a3b8","x":42,"y":90},
    {"id":"w4","type":"player","label":"W4","color":"#94a3b8","x":50,"y":90},
    {"id":"w5","type":"player","label":"W5","color":"#94a3b8","x":58,"y":90},
    {"id":"pc","type":"player","label":"C","color":"#94a3b8","x":66,"y":90},
    {"id":"w2","type":"player","label":"W2","color":"#22c55e","x":50,"y":50},
    {"id":"p0","type":"player","label":"1","color":"#0ea5e9","x":75,"y":50},
    {"id":"p1","type":"player","label":"2","color":"#0ea5e9","x":62.5,"y":71.65},
    {"id":"p2","type":"player","label":"3","color":"#0ea5e9","x":37.5,"y":71.65},
    {"id":"p3","type":"player","label":"4","color":"#0ea5e9","x":25,"y":50},
    {"id":"p4","type":"player","label":"5","color":"#0ea5e9","x":37.5,"y":28.35},
    {"id":"p5","type":"player","label":"6","color":"#0ea5e9","x":62.5,"y":28.35}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"r-text","type":"text","geometry":{"text":"Cycle — W2 leads, original 6 stretch","x":50,"y":15}}
  ]$JSON$::jsonb
);
