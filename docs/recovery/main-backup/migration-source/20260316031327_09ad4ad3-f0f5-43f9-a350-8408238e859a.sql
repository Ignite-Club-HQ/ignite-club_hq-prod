-- Add 18 more demo players to the mini league
INSERT INTO mini_league_players (mini_league_id, name, ability_rating) VALUES
  ('d1b2c3d4-0001-4000-8000-000000000001', 'Ryan Mitchell', 4),
  ('d1b2c3d4-0001-4000-8000-000000000001', 'Alfie Robinson', 2),
  ('d1b2c3d4-0001-4000-8000-000000000001', 'Max Turner', 5),
  ('d1b2c3d4-0001-4000-8000-000000000001', 'Finn Walker', 3),
  ('d1b2c3d4-0001-4000-8000-000000000001', 'Jake Anderson', 1),
  ('d1b2c3d4-0001-4000-8000-000000000001', 'Sam Cooper', 4),
  ('d1b2c3d4-0001-4000-8000-000000000001', 'Leo Bennett', 3),
  ('d1b2c3d4-0001-4000-8000-000000000001', 'Archie Hughes', 2),
  ('d1b2c3d4-0001-4000-8000-000000000001', 'Harry Price', 5),
  ('d1b2c3d4-0001-4000-8000-000000000001', 'George Foster', 3),
  ('d1b2c3d4-0001-4000-8000-000000000001', 'Toby Evans', 4),
  ('d1b2c3d4-0001-4000-8000-000000000001', 'Daniel Ward', 2),
  ('d1b2c3d4-0001-4000-8000-000000000001', 'Zach Morgan', 1),
  ('d1b2c3d4-0001-4000-8000-000000000001', 'Will Barnes', 3),
  ('d1b2c3d4-0001-4000-8000-000000000001', 'Ben Kelly', 4),
  ('d1b2c3d4-0001-4000-8000-000000000001', 'Josh Reed', 2),
  ('d1b2c3d4-0001-4000-8000-000000000001', 'Adam Scott', 5),
  ('d1b2c3d4-0001-4000-8000-000000000001', 'Luke Perry', 3);

-- Now insert RSVPs for ALL players (including the new ones and existing ones without going RSVPs)
-- We need to insert RSVPs for the new players + Oscar Lee (currently 'maybe') and Henry Taylor (currently 'not_going')
-- First update existing non-going RSVPs to going
UPDATE rsvps SET status = 'going' WHERE event_id = '065db5e8-1af8-463b-b8b9-6cc24cb2e3a6' AND status != 'going';