-- Add a policy allowing authenticated users to view all teams (for join requests)
-- Teams are public within the app - users need to see them to request joining

CREATE POLICY "Authenticated users can view all teams for join requests"
ON public.teams
FOR SELECT
TO authenticated
USING (true);

-- Note: The existing "Club members can view teams" policy remains for backwards compatibility
-- This new policy is additive and allows broader read access for authenticated users