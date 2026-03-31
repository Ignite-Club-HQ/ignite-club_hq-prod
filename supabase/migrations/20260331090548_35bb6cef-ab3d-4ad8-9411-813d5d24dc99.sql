-- Allow users to update their own club messages
CREATE POLICY "Users can update their own club messages"
ON public.club_messages
FOR UPDATE
TO authenticated
USING (author_id = auth.uid())
WITH CHECK (author_id = auth.uid());

-- Allow users to update their own group messages
CREATE POLICY "Users can update their own group messages"
ON public.group_messages
FOR UPDATE
TO authenticated
USING (author_id = auth.uid())
WITH CHECK (author_id = auth.uid());