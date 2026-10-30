-- Add UPDATE policy for message_reactions so users can change their reaction type
CREATE POLICY "Users can update their own message reactions"
ON public.message_reactions
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);