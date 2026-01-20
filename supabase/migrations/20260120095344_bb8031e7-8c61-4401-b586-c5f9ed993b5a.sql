-- Make the avatars bucket public so avatar images can be viewed without signing
UPDATE storage.buckets 
SET public = true 
WHERE id = 'avatars';