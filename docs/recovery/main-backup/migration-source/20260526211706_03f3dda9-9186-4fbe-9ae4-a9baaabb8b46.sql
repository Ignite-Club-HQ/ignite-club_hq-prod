
-- club_messages: allow author to delete own message (admins already can)
CREATE POLICY "Authors can delete their own club messages"
ON public.club_messages
FOR DELETE
TO authenticated
USING (author_id = auth.uid());

-- broadcast_messages: allow author to update and delete own message
CREATE POLICY "Authors can update their own broadcast messages"
ON public.broadcast_messages
FOR UPDATE
TO authenticated
USING (author_id = auth.uid())
WITH CHECK (author_id = auth.uid());

CREATE POLICY "Authors can delete their own broadcast messages"
ON public.broadcast_messages
FOR DELETE
TO authenticated
USING (author_id = auth.uid());

-- club_admin_messages: allow author to delete own message
CREATE POLICY "Authors can delete their own club admin messages"
ON public.club_admin_messages
FOR DELETE
TO authenticated
USING (author_id = auth.uid());
