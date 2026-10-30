-- Add DELETE policy for group messages so users can delete their own messages
CREATE POLICY "Users can delete their own group messages"
ON public.group_messages
FOR DELETE
USING (author_id = auth.uid());