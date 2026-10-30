-- Allow coaches (and existing team admins / app admins) to manage the team_subscriptions
-- row backing the pitch board. Previously only team_admin/app_admin could write,
-- so coaches changing the half-duration on the pitch board silently failed.
DROP POLICY IF EXISTS "Team admins can manage subscriptions" ON public.team_subscriptions;

CREATE POLICY "Team admins and coaches can manage subscriptions"
ON public.team_subscriptions
FOR ALL
USING (
  public.has_role(auth.uid(), 'team_admin'::app_role, NULL::uuid, team_id)
  OR public.has_role(auth.uid(), 'coach'::app_role, NULL::uuid, team_id)
  OR public.has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
)
WITH CHECK (
  public.has_role(auth.uid(), 'team_admin'::app_role, NULL::uuid, team_id)
  OR public.has_role(auth.uid(), 'coach'::app_role, NULL::uuid, team_id)
  OR public.has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
);