-- Make chat-attachments bucket private
UPDATE storage.buckets SET public = false WHERE id = 'chat-attachments';

-- Make avatars bucket private
UPDATE storage.buckets SET public = false WHERE id = 'avatars';

-- Drop and recreate policies for chat-attachments
DROP POLICY IF EXISTS "Authenticated users can access chat-attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload chat-attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete chat-attachments" ON storage.objects;

CREATE POLICY "Authenticated users can access chat-attachments"
ON storage.objects FOR SELECT
USING (bucket_id = 'chat-attachments' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can upload chat-attachments"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'chat-attachments' AND auth.role() = 'authenticated');

CREATE POLICY "Users can delete chat-attachments"
ON storage.objects FOR DELETE
USING (bucket_id = 'chat-attachments' AND auth.role() = 'authenticated');

-- Drop and recreate policies for avatars
DROP POLICY IF EXISTS "Authenticated users can access avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can update avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete avatars" ON storage.objects;
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;

CREATE POLICY "Authenticated users can access avatars"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can upload avatars"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'avatars' AND auth.role() = 'authenticated');

CREATE POLICY "Users can update avatars"
ON storage.objects FOR UPDATE
USING (bucket_id = 'avatars' AND auth.role() = 'authenticated');

CREATE POLICY "Users can delete avatars"
ON storage.objects FOR DELETE
USING (bucket_id = 'avatars' AND auth.role() = 'authenticated');