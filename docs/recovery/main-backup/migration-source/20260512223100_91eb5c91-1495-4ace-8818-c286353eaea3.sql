
-- Replace events SELECT policy to scope mini-league events
DROP POLICY IF EXISTS "Members can view events" ON public.events;
CREATE POLICY "Members can view events"
ON public.events
FOR SELECT
USING (
  -- Mini-league events: only league members + admins
  (mini_league_id IS NOT NULL AND (
    has_role(auth.uid(), 'club_admin'::app_role, club_id, NULL::uuid)
    OR has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
    OR has_role(auth.uid(), 'league_admin'::app_role, club_id, NULL::uuid)
    OR EXISTS (
      SELECT 1 FROM public.mini_league_admins mla
      WHERE mla.mini_league_id = events.mini_league_id
        AND mla.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.mini_league_players mlp
      WHERE mlp.mini_league_id = events.mini_league_id
        AND mlp.parent_user_id = auth.uid()
    )
  ))
  -- Club-wide events (no team, no league)
  OR (mini_league_id IS NULL AND team_id IS NULL AND is_club_member(auth.uid(), club_id))
  -- Team events
  OR (team_id IS NOT NULL AND (
    is_team_member(auth.uid(), team_id)
    OR has_role(auth.uid(), 'club_admin'::app_role, club_id, NULL::uuid)
    OR has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
  ))
);

-- Allow parents to manage their mini-league player's RSVPs
DROP POLICY IF EXISTS "Parents can manage their league player RSVPs" ON public.rsvps;
CREATE POLICY "Parents can manage their league player RSVPs"
ON public.rsvps
FOR ALL
USING (
  mini_league_player_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.mini_league_players mlp
    WHERE mlp.id = rsvps.mini_league_player_id
      AND mlp.parent_user_id = auth.uid()
  )
)
WITH CHECK (
  mini_league_player_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.mini_league_players mlp
    WHERE mlp.id = rsvps.mini_league_player_id
      AND mlp.parent_user_id = auth.uid()
  )
);

-- Extend rsvps SELECT so league members can see RSVPs for league events
DROP POLICY IF EXISTS "Users can view RSVPs for events they can see" ON public.rsvps;
CREATE POLICY "Users can view RSVPs for events they can see"
ON public.rsvps
FOR SELECT
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = rsvps.event_id
      AND (
        -- Club/team membership (legacy paths)
        EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid() AND ur.club_id = e.club_id
        )
        OR (e.team_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid() AND ur.team_id = e.team_id
        ))
        -- Mini-league members
        OR (e.mini_league_id IS NOT NULL AND (
          EXISTS (
            SELECT 1 FROM public.mini_league_admins mla
            WHERE mla.mini_league_id = e.mini_league_id AND mla.user_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM public.mini_league_players mlp
            WHERE mlp.mini_league_id = e.mini_league_id AND mlp.parent_user_id = auth.uid()
          )
        ))
      )
  )
);
