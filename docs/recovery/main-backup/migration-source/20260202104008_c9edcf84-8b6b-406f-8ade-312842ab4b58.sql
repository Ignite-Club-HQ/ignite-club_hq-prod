
-- Fix can_view_mini_league function to include committee_member role
CREATE OR REPLACE FUNCTION public.can_view_mini_league(_user_id uuid, _mini_league_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    -- User is a league admin, club admin, coach, or committee member in the club
    SELECT 1 FROM user_roles ur
    JOIN mini_leagues ml ON ml.club_id = ur.club_id
    WHERE ml.id = _mini_league_id
    AND ur.user_id = _user_id
    AND ur.role IN ('league_admin', 'club_admin', 'coach', 'app_admin', 'committee_member')
  )
  OR EXISTS (
    -- User is a parent with a child in this league
    SELECT 1 FROM mini_league_players mlp
    WHERE mlp.mini_league_id = _mini_league_id
    AND mlp.parent_user_id = _user_id
  )
$$;
