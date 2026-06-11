
-- Add per-event role restriction for club-wide social events.
-- NULL or empty array = no restriction (current behaviour). When set,
-- only club members holding one of the listed roles (plus club_admin/app_admin)
-- can SELECT the event.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS restricted_to_roles app_role[];

-- Replace SELECT policy to honour restricted_to_roles for club-wide events.
DROP POLICY IF EXISTS "Members can view events" ON public.events;

CREATE POLICY "Members can view events"
ON public.events
FOR SELECT
USING (
  (
    (mini_league_id IS NOT NULL) AND (
      has_role((SELECT auth.uid()), 'club_admin'::app_role, club_id, NULL::uuid)
      OR has_role((SELECT auth.uid()), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
      OR has_role((SELECT auth.uid()), 'league_admin'::app_role, club_id, NULL::uuid)
      OR EXISTS (SELECT 1 FROM mini_league_admins mla WHERE mla.mini_league_id = events.mini_league_id AND mla.user_id = (SELECT auth.uid()))
      OR EXISTS (SELECT 1 FROM mini_league_players mlp WHERE mlp.mini_league_id = events.mini_league_id AND mlp.parent_user_id = (SELECT auth.uid()))
    )
  )
  OR (
    (mini_league_id IS NULL) AND (team_id IS NULL)
    AND is_club_member((SELECT auth.uid()), club_id)
    AND (
      restricted_to_roles IS NULL
      OR cardinality(restricted_to_roles) = 0
      OR has_role((SELECT auth.uid()), 'club_admin'::app_role, club_id, NULL::uuid)
      OR has_role((SELECT auth.uid()), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = (SELECT auth.uid())
          AND ur.club_id = events.club_id
          AND ur.role = ANY(events.restricted_to_roles)
      )
    )
  )
  OR (
    (team_id IS NOT NULL) AND (
      is_team_member((SELECT auth.uid()), team_id)
      OR has_role((SELECT auth.uid()), 'club_admin'::app_role, club_id, NULL::uuid)
      OR has_role((SELECT auth.uid()), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
    )
  )
);
