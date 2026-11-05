-- Drop and recreate the UPDATE policy to handle mini-league events
DROP POLICY IF EXISTS "Admins/coaches can update events" ON public.events;

CREATE POLICY "Admins/coaches can update events"
ON public.events
FOR UPDATE
USING (
  has_role(auth.uid(), 'club_admin'::app_role, club_id, NULL::uuid) 
  OR has_role(auth.uid(), 'team_admin'::app_role, NULL::uuid, team_id)
  OR has_role(auth.uid(), 'coach'::app_role, NULL::uuid, team_id)
  -- For mini-league events (team_id is NULL, mini_league_id is set):
  -- Allow league_admin at club level
  OR (mini_league_id IS NOT NULL AND has_role(auth.uid(), 'league_admin'::app_role, club_id, NULL::uuid))
  -- Allow coach at club level for mini-league events
  OR (mini_league_id IS NOT NULL AND has_role(auth.uid(), 'coach'::app_role, club_id, NULL::uuid))
);

-- Also update DELETE policy for consistency
DROP POLICY IF EXISTS "Admins/coaches can delete events" ON public.events;

CREATE POLICY "Admins/coaches can delete events"
ON public.events
FOR DELETE
USING (
  has_role(auth.uid(), 'club_admin'::app_role, club_id, NULL::uuid) 
  OR has_role(auth.uid(), 'team_admin'::app_role, NULL::uuid, team_id)
  OR has_role(auth.uid(), 'coach'::app_role, NULL::uuid, team_id)
  -- For mini-league events:
  OR (mini_league_id IS NOT NULL AND has_role(auth.uid(), 'league_admin'::app_role, club_id, NULL::uuid))
  OR (mini_league_id IS NOT NULL AND has_role(auth.uid(), 'coach'::app_role, club_id, NULL::uuid))
);

-- Also update INSERT policy for consistency
DROP POLICY IF EXISTS "Admins/coaches can create events" ON public.events;

CREATE POLICY "Admins/coaches can create events"
ON public.events
FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'club_admin'::app_role, club_id, NULL::uuid) 
  OR has_role(auth.uid(), 'team_admin'::app_role, NULL::uuid, team_id)
  OR has_role(auth.uid(), 'coach'::app_role, NULL::uuid, team_id)
  -- For mini-league events:
  OR (mini_league_id IS NOT NULL AND has_role(auth.uid(), 'league_admin'::app_role, club_id, NULL::uuid))
  OR (mini_league_id IS NOT NULL AND has_role(auth.uid(), 'coach'::app_role, club_id, NULL::uuid))
);