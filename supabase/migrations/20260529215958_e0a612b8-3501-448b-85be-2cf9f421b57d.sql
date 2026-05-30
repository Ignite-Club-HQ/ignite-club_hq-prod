-- Break the user_roles ↔ team_invites RLS recursion cycle by replacing raw
-- user_roles subqueries inside team_invites policies with the SECURITY DEFINER
-- has_role() helper (owner=postgres, BYPASSRLS — opaque to RLS expansion).

DROP POLICY IF EXISTS "Admins and creators can view team invites" ON public.team_invites;
DROP POLICY IF EXISTS "Team and club admins can manage invites" ON public.team_invites;

CREATE POLICY "Admins and creators can view team invites"
ON public.team_invites
FOR SELECT
USING (
  created_by = (SELECT auth.uid())
  OR public.has_role((SELECT auth.uid()), 'app_admin'::app_role, NULL, NULL)
  OR public.has_role((SELECT auth.uid()), 'team_admin'::app_role, NULL, team_id)
  OR public.has_role(
       (SELECT auth.uid()),
       'club_admin'::app_role,
       (SELECT t.club_id FROM public.teams t WHERE t.id = team_invites.team_id),
       NULL
     )
);

CREATE POLICY "Team and club admins can manage invites"
ON public.team_invites
FOR ALL
USING (
  public.has_role((SELECT auth.uid()), 'app_admin'::app_role, NULL, NULL)
  OR public.has_role((SELECT auth.uid()), 'team_admin'::app_role, NULL, team_id)
  OR public.has_role((SELECT auth.uid()), 'coach'::app_role, NULL, team_id)
  OR public.has_role((SELECT auth.uid()), 'club_admin'::app_role, NULL, team_id)
  OR public.has_role(
       (SELECT auth.uid()),
       'club_admin'::app_role,
       (SELECT t.club_id FROM public.teams t WHERE t.id = team_invites.team_id),
       NULL
     )
  OR EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = team_invites.team_id
      AND t.created_by = (SELECT auth.uid())
  )
)
WITH CHECK (
  public.has_role((SELECT auth.uid()), 'app_admin'::app_role, NULL, NULL)
  OR public.has_role((SELECT auth.uid()), 'team_admin'::app_role, NULL, team_id)
  OR public.has_role((SELECT auth.uid()), 'coach'::app_role, NULL, team_id)
  OR public.has_role((SELECT auth.uid()), 'club_admin'::app_role, NULL, team_id)
  OR public.has_role(
       (SELECT auth.uid()),
       'club_admin'::app_role,
       (SELECT t.club_id FROM public.teams t WHERE t.id = team_invites.team_id),
       NULL
     )
  OR EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = team_invites.team_id
      AND t.created_by = (SELECT auth.uid())
  )
);