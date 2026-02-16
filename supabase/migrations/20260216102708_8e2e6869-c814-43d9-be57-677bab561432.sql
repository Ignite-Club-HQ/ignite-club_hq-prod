-- Drop the existing overly-restrictive policy
DROP POLICY IF EXISTS "Users can manage their own message reads" ON public.message_reads;

-- Allow users to read ALL message read records (not sensitive data - just "user X read message Y")
-- This is needed so message senders can see when recipients read their messages
CREATE POLICY "Users can view message reads"
ON public.message_reads
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Users can only INSERT/UPDATE/DELETE their own read records
CREATE POLICY "Users can insert their own reads"
ON public.message_reads
FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own reads"
ON public.message_reads
FOR DELETE
USING (user_id = auth.uid());