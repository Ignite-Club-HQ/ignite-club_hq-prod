-- Clean up demo data from non-demo clubs (e.g., "Test" club)
-- Demo clubs are: 'Riverside FC', 'Northern United', 'Eastside Athletic'

-- Delete photo reactions from non-demo club photos
DELETE FROM photo_reactions 
WHERE photo_id IN (
  SELECT p.id FROM photos p 
  JOIN clubs c ON p.club_id = c.id 
  WHERE c.name NOT IN ('Riverside FC', 'Northern United', 'Eastside Athletic')
  AND (p.file_url IS NULL OR p.file_url LIKE '%unsplash.com%')
);

-- Delete photo comments from non-demo club photos
DELETE FROM photo_comments 
WHERE photo_id IN (
  SELECT p.id FROM photos p 
  JOIN clubs c ON p.club_id = c.id 
  WHERE c.name NOT IN ('Riverside FC', 'Northern United', 'Eastside Athletic')
  AND (p.file_url IS NULL OR p.file_url LIKE '%unsplash.com%')
);

-- Delete demo photos from non-demo clubs (photos with no file_url or unsplash URLs)
DELETE FROM photos 
WHERE id IN (
  SELECT p.id FROM photos p 
  JOIN clubs c ON p.club_id = c.id 
  WHERE c.name NOT IN ('Riverside FC', 'Northern United', 'Eastside Athletic')
  AND (p.file_url IS NULL OR p.file_url LIKE '%unsplash.com%')
);