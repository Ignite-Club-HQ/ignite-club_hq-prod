-- Fix storage_used_bytes for club 966bdaec-ebf1-46da-b2b3-cc53bf05c422
-- Recalculate based on actual vault_files that exist and are not deleted
UPDATE clubs 
SET storage_used_bytes = COALESCE((
  SELECT SUM(file_size) 
  FROM vault_files 
  WHERE club_id = '966bdaec-ebf1-46da-b2b3-cc53bf05c422' 
    AND deleted_at IS NULL
), 0)
WHERE id = '966bdaec-ebf1-46da-b2b3-cc53bf05c422';

-- Also clean up orphaned photo records with NULL file_url for this club
DELETE FROM photos 
WHERE club_id = '966bdaec-ebf1-46da-b2b3-cc53bf05c422' 
  AND file_url IS NULL;