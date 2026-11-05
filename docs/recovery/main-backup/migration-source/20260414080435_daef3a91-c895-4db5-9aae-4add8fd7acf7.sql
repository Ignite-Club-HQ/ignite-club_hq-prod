
-- Security definer function to check if user can access a chat attachment
CREATE OR REPLACE FUNCTION public.can_access_chat_attachment(_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- General folder: user owns the file (path: general/{userId}/...)
    (storage.foldername(_name))[1] = 'general'
      AND (storage.foldername(_name))[2] = auth.uid()::text
    OR
    -- Club folder: user is a member of the club (path: clubs/{clubId}/...)
    (
      (storage.foldername(_name))[1] = 'clubs'
      AND EXISTS (
        SELECT 1 FROM user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.club_id = ((storage.foldername(_name))[2])::uuid
      )
    )
$$;

-- Drop overly permissive SELECT policies
DROP POLICY IF EXISTS "Authenticated users can access chat-attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view chat attachments" ON storage.objects;

-- Create scoped SELECT policy
CREATE POLICY "Users can view chat attachments in their clubs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND public.can_access_chat_attachment(name)
);
