
CREATE OR REPLACE FUNCTION public.can_access_chat_attachment(_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- General folder: user owns the file (path: general/{userId}/...)
    (
      (storage.foldername(_name))[1] = 'general'
      AND (storage.foldername(_name))[2] = auth.uid()::text
    )
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
    OR
    -- Legacy format: bare userId prefix (path: {userId}/...)
    (
      (storage.foldername(_name))[1] != 'clubs'
      AND (storage.foldername(_name))[1] != 'general'
      AND (storage.foldername(_name))[1] = auth.uid()::text
    )
$$;
