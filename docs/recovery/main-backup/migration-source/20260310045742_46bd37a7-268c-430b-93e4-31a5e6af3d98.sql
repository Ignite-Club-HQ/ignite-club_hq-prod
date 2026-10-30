
-- Award 100 ignite points to user "Reviewer"
UPDATE profiles SET ignite_points = ignite_points + 100 WHERE id = 'a37b4b18-159b-4ab3-90ad-48eb85456d0d';

-- Record in points history
INSERT INTO points_history (user_id, amount, balance_after, source_type, description)
VALUES (
  'a37b4b18-159b-4ab3-90ad-48eb85456d0d',
  100,
  101,
  'admin_award',
  'Points awarded by admin'
);
