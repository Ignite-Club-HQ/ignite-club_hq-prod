-- Safe RLS perf: wrap auth.uid() in (SELECT auth.uid()) on user_roles
-- so Postgres evaluates it once per query instead of once per row.
-- No semantics change. Fully reversible.

-- SELECT policy (hottest path)
DROP POLICY IF EXISTS "Users can view roles in their clubs/teams" ON public.user_roles;
CREATE POLICY "Users can view roles in their clubs/teams"
ON public.user_roles
FOR SELECT
USING (
  (user_id = (SELECT auth.uid()))
  OR is_club_member((SELECT auth.uid()), club_id)
  OR is_team_member((SELECT auth.uid()), team_id)
  OR has_role((SELECT auth.uid()), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
);

-- DELETE policy
DROP POLICY IF EXISTS "Users can delete their own roles" ON public.user_roles;
CREATE POLICY "Users can delete their own roles"
ON public.user_roles
FOR DELETE
USING (user_id = (SELECT auth.uid()));

-- Manage-all policy
DROP POLICY IF EXISTS "Club admins can manage roles" ON public.user_roles;
CREATE POLICY "Club admins can manage roles"
ON public.user_roles
FOR ALL
USING (
  has_role((SELECT auth.uid()), 'club_admin'::app_role, club_id, NULL::uuid)
  OR has_role((SELECT auth.uid()), 'team_admin'::app_role, NULL::uuid, team_id)
  OR has_role((SELECT auth.uid()), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
);