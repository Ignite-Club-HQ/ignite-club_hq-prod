
-- Step 1: Add Fi Crowe as a guardian of the original Paddy (Andrew's child)
INSERT INTO child_guardians (child_id, guardian_id, relationship_type, is_primary)
VALUES ('b6b81393-405d-462d-b557-bbd2d062eed0', 'c6344941-7812-42ad-8bfe-aaf78ecc1d7f', 'parent', false)
ON CONFLICT DO NOTHING;

-- Step 2: Delete the duplicate team assignment for Fi's duplicate Paddy
DELETE FROM child_team_assignments WHERE child_id = '8175e1a7-5652-4a34-a8e2-916ac5edc3c6';

-- Step 3: Delete the duplicate child record (Fi's Paddy)
DELETE FROM children WHERE id = '8175e1a7-5652-4a34-a8e2-916ac5edc3c6';
