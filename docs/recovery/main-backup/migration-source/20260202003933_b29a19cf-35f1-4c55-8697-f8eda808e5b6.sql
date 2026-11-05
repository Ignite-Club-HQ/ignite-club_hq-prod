
-- Fix overly permissive RLS policy on mini_leagues
-- The "Authenticated users can view all mini leagues for join requests" policy with qual:true
-- is too permissive and allows any authenticated user to see all mini leagues

-- Drop the problematic policy
DROP POLICY IF EXISTS "Authenticated users can view all mini leagues for join requests" ON public.mini_leagues;

-- The existing "Club members can view mini leagues" policy is also too permissive
-- since any club member can see all mini leagues in that club.
-- For mini leagues, we want stricter access:
-- 1. League admins/club admins/coaches can see leagues in their club
-- 2. Parents with children in the league can see those leagues

DROP POLICY IF EXISTS "Club members can view mini leagues" ON public.mini_leagues;

-- Create a function to check if user can view a mini league
CREATE OR REPLACE FUNCTION public.can_view_mini_league(_user_id uuid, _mini_league_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    -- User is a league admin, club admin, or coach in the club
    SELECT 1 FROM user_roles ur
    JOIN mini_leagues ml ON ml.club_id = ur.club_id
    WHERE ml.id = _mini_league_id
    AND ur.user_id = _user_id
    AND ur.role IN ('league_admin', 'club_admin', 'coach', 'app_admin')
  )
  OR EXISTS (
    -- User is a parent with a child in this league
    SELECT 1 FROM mini_league_players mlp
    WHERE mlp.mini_league_id = _mini_league_id
    AND mlp.parent_user_id = _user_id
  )
$$;

-- Create proper SELECT policy
CREATE POLICY "Users can view mini leagues they have access to"
ON public.mini_leagues
FOR SELECT
USING (
  public.can_view_mini_league(auth.uid(), id)
);
