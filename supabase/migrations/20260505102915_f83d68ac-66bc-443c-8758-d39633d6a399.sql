-- Reset Basket Range Cricket Club points to zero
DELETE FROM points_history WHERE club_id='493ee2e3-c834-487d-93be-d1c8a0dbc4a8';
UPDATE user_club_points SET points=0 WHERE club_id='493ee2e3-c834-487d-93be-d1c8a0dbc4a8';
UPDATE child_club_points SET points=0 WHERE club_id='493ee2e3-c834-487d-93be-d1c8a0dbc4a8';
DELETE FROM points_cooldowns WHERE club_id='493ee2e3-c834-487d-93be-d1c8a0dbc4a8';