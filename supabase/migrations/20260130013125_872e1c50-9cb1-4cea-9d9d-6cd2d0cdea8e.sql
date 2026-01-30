-- Add policy for authenticated users to view all mini leagues for join requests
CREATE POLICY "Authenticated users can view all mini leagues for join requests"
ON public.mini_leagues
FOR SELECT
TO authenticated
USING (true);