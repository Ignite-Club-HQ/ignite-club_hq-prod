-- Security definer helper: can _viewer (an admin) view children of _parent?
CREATE OR REPLACE FUNCTION public.can_admin_view_child_of_parent(_viewer uuid, _parent uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    -- Viewer holds an admin role in a club the parent belongs to
    SELECT 1
    FROM user_roles me
    JOIN user_roles pr ON pr.club_id = me.club_id
    WHERE me.user_id = _viewer
      AND me.role IN ('club_admin', 'league_admin', 'app_admin')
      AND pr.user_id = _parent
  )
  OR EXISTS (
    -- Viewer is a per-mini-league admin in a club the parent belongs to
    SELECT 1
    FROM mini_league_admins mla
    JOIN mini_leagues ml ON ml.id = mla.mini_league_id
    JOIN user_roles pr ON pr.club_id = ml.club_id
    WHERE mla.user_id = _viewer
      AND pr.user_id = _parent
  )
$$;

DROP POLICY IF EXISTS "Admins can view children of club parents" ON public.children;
CREATE POLICY "Admins can view children of club parents"
ON public.children
FOR SELECT
TO authenticated
USING (public.can_admin_view_child_of_parent((SELECT auth.uid()), parent_id));