-- Helper: is the user an admin of ANY mini league (security definer bypasses RLS on mini_league_admins)
CREATE OR REPLACE FUNCTION public.is_any_mini_league_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mini_league_admins mla
    WHERE mla.user_id = _user_id
  )
$$;

-- Recreate children INSERT policy using the security-definer helper
DROP POLICY IF EXISTS "Admins can create children for team members" ON public.children;
CREATE POLICY "Admins can create children for team members"
ON public.children
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = (SELECT auth.uid())
      AND ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role, 'club_admin'::app_role, 'app_admin'::app_role, 'league_admin'::app_role])
  )
  OR public.is_any_mini_league_admin((SELECT auth.uid()))
);

-- Make per-league admins able to view their league (and therefore their own admin row)
CREATE OR REPLACE FUNCTION public.can_view_mini_league(_user_id uuid, _mini_league_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN mini_leagues ml ON ml.club_id = ur.club_id
    WHERE ml.id = _mini_league_id
    AND ur.user_id = _user_id
    AND ur.role IN ('league_admin', 'club_admin', 'coach', 'app_admin', 'committee_member')
  )
  OR EXISTS (
    SELECT 1 FROM mini_league_players mlp
    WHERE mlp.mini_league_id = _mini_league_id
    AND mlp.parent_user_id = _user_id
  )
  OR EXISTS (
    SELECT 1 FROM mini_league_admins mla
    WHERE mla.mini_league_id = _mini_league_id
    AND mla.user_id = _user_id
  )
$$;