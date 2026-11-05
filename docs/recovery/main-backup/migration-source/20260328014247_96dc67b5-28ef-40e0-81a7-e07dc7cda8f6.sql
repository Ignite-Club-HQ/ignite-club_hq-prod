-- Update INSERT policy on events to allow committee members to create social all-club events
DROP POLICY IF EXISTS "Admins/coaches can create events" ON public.events;

CREATE POLICY "Admins/coaches can create events" ON public.events
FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'club_admin'::app_role, club_id, NULL::uuid)
  OR has_role(auth.uid(), 'team_admin'::app_role, NULL::uuid, team_id)
  OR has_role(auth.uid(), 'coach'::app_role, NULL::uuid, team_id)
  OR ((mini_league_id IS NOT NULL) AND has_role(auth.uid(), 'league_admin'::app_role, club_id, NULL::uuid))
  OR ((mini_league_id IS NOT NULL) AND has_role(auth.uid(), 'coach'::app_role, club_id, NULL::uuid))
  OR (has_role(auth.uid(), 'committee_member'::app_role, club_id, NULL::uuid) AND type = 'social' AND team_id IS NULL)
);

DROP POLICY IF EXISTS "Admins/coaches can update events" ON public.events;

CREATE POLICY "Admins/coaches can update events" ON public.events
FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'club_admin'::app_role, club_id, NULL::uuid)
  OR has_role(auth.uid(), 'team_admin'::app_role, NULL::uuid, team_id)
  OR has_role(auth.uid(), 'coach'::app_role, NULL::uuid, team_id)
  OR ((mini_league_id IS NOT NULL) AND has_role(auth.uid(), 'league_admin'::app_role, club_id, NULL::uuid))
  OR ((mini_league_id IS NOT NULL) AND has_role(auth.uid(), 'coach'::app_role, club_id, NULL::uuid))
  OR (has_role(auth.uid(), 'committee_member'::app_role, club_id, NULL::uuid) AND type = 'social' AND team_id IS NULL)
);

DROP POLICY IF EXISTS "Admins/coaches can delete events" ON public.events;

CREATE POLICY "Admins/coaches can delete events" ON public.events
FOR DELETE TO authenticated
USING (
  has_role(auth.uid(), 'club_admin'::app_role, club_id, NULL::uuid)
  OR has_role(auth.uid(), 'team_admin'::app_role, NULL::uuid, team_id)
  OR has_role(auth.uid(), 'coach'::app_role, NULL::uuid, team_id)
  OR ((mini_league_id IS NOT NULL) AND has_role(auth.uid(), 'league_admin'::app_role, club_id, NULL::uuid))
  OR ((mini_league_id IS NOT NULL) AND has_role(auth.uid(), 'coach'::app_role, club_id, NULL::uuid))
  OR (has_role(auth.uid(), 'committee_member'::app_role, club_id, NULL::uuid) AND type = 'social' AND team_id IS NULL)
);