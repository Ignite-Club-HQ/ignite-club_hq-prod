-- Fix: Allow authenticated users to see all message reads (needed for read receipts)
-- Previously restricted to user_id = auth.uid() which prevented seeing who read your messages
DROP POLICY IF EXISTS "Users can view their own message reads" ON public.message_reads;

CREATE POLICY "Authenticated users can view message reads"
ON public.message_reads
FOR SELECT
TO authenticated
USING (true);