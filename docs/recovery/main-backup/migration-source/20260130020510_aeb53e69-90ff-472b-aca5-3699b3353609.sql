-- Fix clubs SELECT policy: change from public role to authenticated role
DROP POLICY IF EXISTS "Authenticated users can view clubs" ON public.clubs;

CREATE POLICY "Authenticated users can view all clubs"
ON public.clubs
FOR SELECT
TO authenticated
USING (true);

-- Fix teams SELECT policies: remove the restrictive "Club members can view teams" policy
-- since we want all authenticated users to see all teams for join requests
DROP POLICY IF EXISTS "Club members can view teams" ON public.teams;