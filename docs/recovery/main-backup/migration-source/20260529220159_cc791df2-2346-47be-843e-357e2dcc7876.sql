-- Replace raw user_roles subqueries in pending_invites policies with has_role()
-- (SECURITY DEFINER, owner=postgres, BYPASSRLS — opaque to RLS expansion).
-- Prevents future A↔B recursion if any user_roles policy ever references pending_invites.

DROP POLICY IF EXISTS "Admins can manage pending invites" ON public.pending_invites;
DROP POLICY IF EXISTS "Club admins can view club pending invites" ON public.pending_invites;
DROP POLICY IF EXISTS "Team staff can view club pending invites" ON public.pending_invites;

CREATE POLICY "Admins can manage pending invites"
ON public.pending_invites
FOR ALL
USING (
  public.has_role((SELECT auth.uid()), 'app_admin'::app_role, NULL, NULL)
  OR public.has_role((SELECT auth.uid()), 'team_admin'::app_role, NULL, team_id)
  OR public.has_role((SELECT auth.uid()), 'coach'::app_role, NULL, team_id)
  OR public.has_role((SELECT auth.uid()), 'club_admin'::app_role, club_id, NULL)
)
WITH CHECK (
  public.has_role((SELECT auth.uid()), 'app_admin'::app_role, NULL, NULL)
  OR public.has_role((SELECT auth.uid()), 'team_admin'::app_role, NULL, team_id)
  OR public.has_role((SELECT auth.uid()), 'coach'::app_role, NULL, team_id)
  OR public.has_role((SELECT auth.uid()), 'club_admin'::app_role, club_id, NULL)
);

CREATE POLICY "Club admins can view club pending invites"
ON public.pending_invites
FOR SELECT
USING (
  public.has_role((SELECT auth.uid()), 'club_admin'::app_role, club_id, NULL)
);

CREATE POLICY "Team staff can view club pending invites"
ON public.pending_invites
FOR SELECT
USING (
  club_id IS NOT NULL
  AND (
    public.has_role((SELECT auth.uid()), 'team_admin'::app_role, club_id, NULL)
    OR public.has_role((SELECT auth.uid()), 'coach'::app_role, club_id, NULL)
    OR public.has_role((SELECT auth.uid()), 'club_admin'::app_role, club_id, NULL)
  )
);