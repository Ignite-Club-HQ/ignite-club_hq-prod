
-- =====================================================================
-- Append alternate-outcome frames to additional contest-style drills
-- so the demo doesn't always show the attacker side winning.
--
-- Drills covered:
--   - Pressure and cover (2v2)   id 1627cb14-7d04-4881-81e7-2f17a587b292
--   - Rondo 4v1                  id 451fe054-e38b-43ac-9a57-db95100e08db
--
-- Convention: low y = attacking goal. A defender clearance arrow has
-- to travel toward HIGH y (dy > +20) anchored on a #ef4444 chip — that's
-- the signal the contest-fairness validator rule looks for.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Pressure and cover  (existing max position = 4)
-- ---------------------------------------------------------------------
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '1627cb14-7d04-4881-81e7-2f17a587b292', 5, 2200,
  'Next rep — different pair. This time D1 times the press perfectly and nicks the ball off A1 before he can release it. Reds win the duel.',
  $JSON$[
    {"id":"g1","type":"goal","x":50,"y":8},
    {"id":"a1","type":"player","label":"A1","color":"#0ea5e9","x":35,"y":68,"size":1,"rotation":0},
    {"id":"a2","type":"player","label":"A2","color":"#0ea5e9","x":65,"y":70,"size":1,"rotation":0},
    {"id":"d1","type":"player","label":"D1","color":"#ef4444","x":36,"y":66,"size":1,"rotation":0},
    {"id":"d2","type":"player","label":"D2","color":"#ef4444","x":55,"y":55,"size":1,"rotation":0},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":36,"y":66,"size":1,"rotation":0}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":36,"y":66},"to":{"x":36,"y":68}}},
    {"id":"t1","type":"text","geometry":{"text":"D1 reads it — steals the ball","x":50,"y":40}}
  ]$JSON$::jsonb
);

INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '1627cb14-7d04-4881-81e7-2f17a587b292', 6, 2200,
  'D1 clears the ball away from danger up the pitch. Reset and rotate — different pair, different outcome next time.',
  $JSON$[
    {"id":"g1","type":"goal","x":50,"y":8},
    {"id":"a1","type":"player","label":"A1","color":"#0ea5e9","x":35,"y":72,"size":1,"rotation":0},
    {"id":"a2","type":"player","label":"A2","color":"#0ea5e9","x":65,"y":72,"size":1,"rotation":0},
    {"id":"d1","type":"player","label":"D1","color":"#ef4444","x":40,"y":62,"size":1,"rotation":0},
    {"id":"d2","type":"player","label":"D2","color":"#ef4444","x":55,"y":55,"size":1,"rotation":0},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":92,"size":1,"rotation":0}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":40,"y":62},"to":{"x":50,"y":92}}},
    {"id":"t1","type":"text","geometry":{"text":"Outcomes vary — rotate the pairs","x":50,"y":35}}
  ]$JSON$::jsonb
);

-- ---------------------------------------------------------------------
-- Rondo 4v1  (existing max position = 4)
-- 4 attackers (#0ea5e9) keep the ball, 1 defender (#ef4444) tries to win it.
-- ---------------------------------------------------------------------
INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '451fe054-e38b-43ac-9a57-db95100e08db', 5, 2200,
  'Next rep — a sharper defender. X anticipates the next pass and intercepts it on the move. Defender wins the rondo.',
  $JSON$[
    {"id":"a","type":"player","label":"A","color":"#0ea5e9","x":30,"y":35,"size":1,"rotation":0},
    {"id":"b","type":"player","label":"B","color":"#0ea5e9","x":70,"y":35,"size":1,"rotation":0},
    {"id":"c","type":"player","label":"C","color":"#0ea5e9","x":70,"y":65,"size":1,"rotation":0},
    {"id":"d","type":"player","label":"D","color":"#0ea5e9","x":30,"y":65,"size":1,"rotation":0},
    {"id":"x","type":"player","label":"X","color":"#ef4444","x":55,"y":50,"size":1,"rotation":0},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":55,"y":50,"size":1,"rotation":0}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":55,"y":50},"to":{"x":55,"y":52}}},
    {"id":"t1","type":"text","geometry":{"text":"X intercepts — defender wins this rep","x":50,"y":18}}
  ]$JSON$::jsonb
);

INSERT INTO drill_frames (drill_id, position, duration_ms, notes, objects, annotations)
VALUES (
  '451fe054-e38b-43ac-9a57-db95100e08db', 6, 2200,
  'X clears the ball out of the rondo grid. Roles swap (attacker who lost it goes in the middle) — the next rep will play out differently again.',
  $JSON$[
    {"id":"a","type":"player","label":"A","color":"#0ea5e9","x":30,"y":35,"size":1,"rotation":0},
    {"id":"b","type":"player","label":"B","color":"#0ea5e9","x":70,"y":35,"size":1,"rotation":0},
    {"id":"c","type":"player","label":"C","color":"#0ea5e9","x":70,"y":65,"size":1,"rotation":0},
    {"id":"d","type":"player","label":"D","color":"#0ea5e9","x":30,"y":65,"size":1,"rotation":0},
    {"id":"x","type":"player","label":"X","color":"#ef4444","x":52,"y":55,"size":1,"rotation":0},
    {"id":"b1","type":"ball","color":"#f5f5f5","x":50,"y":92,"size":1,"rotation":0}
  ]$JSON$::jsonb,
  $JSON$[
    {"id":"a1","type":"arrow-solid","style":{"color":"#ef4444"},"geometry":{"from":{"x":52,"y":55},"to":{"x":50,"y":92}}},
    {"id":"t1","type":"text","geometry":{"text":"Different player in the middle next round","x":50,"y":18}}
  ]$JSON$::jsonb
);
