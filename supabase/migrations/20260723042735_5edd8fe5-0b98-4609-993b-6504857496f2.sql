
-- Widen events RLS so club-scoped committee_member can also manage club-wide GAME events.
-- Previously limited to type = 'social'. Now allows type IN ('game','social') when team_id IS NULL.
-- Also adds a WITH CHECK to UPDATE to prevent moving an event into a scope the actor can't manage.

DROP POLICY IF EXISTS "Admins/coaches can create events" ON public.events;
CREATE POLICY "Admins/coaches can create events" ON public.events
FOR INSERT
WITH CHECK (
  has_role((SELECT auth.uid()), 'club_admin'::app_role, club_id, NULL::uuid)
  OR has_role((SELECT auth.uid()), 'team_admin'::app_role, NULL::uuid, team_id)
  OR has_role((SELECT auth.uid()), 'coach'::app_role, NULL::uuid, team_id)
  OR (mini_league_id IS NOT NULL AND has_role((SELECT auth.uid()), 'league_admin'::app_role, club_id, NULL::uuid))
  OR (mini_league_id IS NOT NULL AND has_role((SELECT auth.uid()), 'coach'::app_role, club_id, NULL::uuid))
  OR (
    has_role((SELECT auth.uid()), 'committee_member'::app_role, club_id, NULL::uuid)
    AND team_id IS NULL
    AND type IN ('social'::event_type, 'game'::event_type)
  )
);

DROP POLICY IF EXISTS "Admins/coaches can update events" ON public.events;
CREATE POLICY "Admins/coaches can update events" ON public.events
FOR UPDATE
USING (
  has_role((SELECT auth.uid()), 'club_admin'::app_role, club_id, NULL::uuid)
  OR has_role((SELECT auth.uid()), 'team_admin'::app_role, NULL::uuid, team_id)
  OR has_role((SELECT auth.uid()), 'coach'::app_role, NULL::uuid, team_id)
  OR (mini_league_id IS NOT NULL AND has_role((SELECT auth.uid()), 'league_admin'::app_role, club_id, NULL::uuid))
  OR (mini_league_id IS NOT NULL AND has_role((SELECT auth.uid()), 'coach'::app_role, club_id, NULL::uuid))
  OR (
    has_role((SELECT auth.uid()), 'committee_member'::app_role, club_id, NULL::uuid)
    AND team_id IS NULL
    AND type IN ('social'::event_type, 'game'::event_type)
  )
)
WITH CHECK (
  has_role((SELECT auth.uid()), 'club_admin'::app_role, club_id, NULL::uuid)
  OR has_role((SELECT auth.uid()), 'team_admin'::app_role, NULL::uuid, team_id)
  OR has_role((SELECT auth.uid()), 'coach'::app_role, NULL::uuid, team_id)
  OR (mini_league_id IS NOT NULL AND has_role((SELECT auth.uid()), 'league_admin'::app_role, club_id, NULL::uuid))
  OR (mini_league_id IS NOT NULL AND has_role((SELECT auth.uid()), 'coach'::app_role, club_id, NULL::uuid))
  OR (
    has_role((SELECT auth.uid()), 'committee_member'::app_role, club_id, NULL::uuid)
    AND team_id IS NULL
    AND type IN ('social'::event_type, 'game'::event_type)
  )
);

DROP POLICY IF EXISTS "Admins/coaches can delete events" ON public.events;
CREATE POLICY "Admins/coaches can delete events" ON public.events
FOR DELETE
USING (
  has_role((SELECT auth.uid()), 'club_admin'::app_role, club_id, NULL::uuid)
  OR has_role((SELECT auth.uid()), 'team_admin'::app_role, NULL::uuid, team_id)
  OR has_role((SELECT auth.uid()), 'coach'::app_role, NULL::uuid, team_id)
  OR (mini_league_id IS NOT NULL AND has_role((SELECT auth.uid()), 'league_admin'::app_role, club_id, NULL::uuid))
  OR (mini_league_id IS NOT NULL AND has_role((SELECT auth.uid()), 'coach'::app_role, club_id, NULL::uuid))
  OR (
    has_role((SELECT auth.uid()), 'committee_member'::app_role, club_id, NULL::uuid)
    AND team_id IS NULL
    AND type IN ('social'::event_type, 'game'::event_type)
  )
);
