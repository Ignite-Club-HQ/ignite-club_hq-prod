-- Performance fix: wrap auth.uid() in (SELECT auth.uid()) on rsvps RLS policies
-- so Postgres evaluates it once per query (initPlan) instead of once per row.
-- Logic is identical; this is a pure perf rewrite.
--
-- ROLLBACK (re-create original policies):
--   See git history of this migration file for the previous CREATE POLICY statements.

BEGIN;

DROP POLICY IF EXISTS "Users can manage their own RSVPs" ON public.rsvps;
CREATE POLICY "Users can manage their own RSVPs"
ON public.rsvps
AS PERMISSIVE
FOR ALL
TO public
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Guardians can manage child RSVPs" ON public.rsvps;
CREATE POLICY "Guardians can manage child RSVPs"
ON public.rsvps
AS PERMISSIVE
FOR ALL
TO public
USING (
  (child_id IS NOT NULL) AND (EXISTS (
    SELECT 1 FROM child_guardians cg
    WHERE cg.child_id = rsvps.child_id
      AND cg.guardian_id = (SELECT auth.uid())
  ))
)
WITH CHECK (
  (child_id IS NOT NULL) AND (EXISTS (
    SELECT 1 FROM child_guardians cg
    WHERE cg.child_id = rsvps.child_id
      AND cg.guardian_id = (SELECT auth.uid())
  ))
);

DROP POLICY IF EXISTS "Parents can manage their league player RSVPs" ON public.rsvps;
CREATE POLICY "Parents can manage their league player RSVPs"
ON public.rsvps
AS PERMISSIVE
FOR ALL
TO public
USING (
  (mini_league_player_id IS NOT NULL) AND (EXISTS (
    SELECT 1 FROM mini_league_players mlp
    WHERE mlp.id = rsvps.mini_league_player_id
      AND mlp.parent_user_id = (SELECT auth.uid())
  ))
)
WITH CHECK (
  (mini_league_player_id IS NOT NULL) AND (EXISTS (
    SELECT 1 FROM mini_league_players mlp
    WHERE mlp.id = rsvps.mini_league_player_id
      AND mlp.parent_user_id = (SELECT auth.uid())
  ))
);

DROP POLICY IF EXISTS "Admins can manage RSVPs" ON public.rsvps;
CREATE POLICY "Admins can manage RSVPs"
ON public.rsvps
AS PERMISSIVE
FOR ALL
TO public
USING (
  EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = rsvps.event_id
      AND (
        has_role((SELECT auth.uid()), 'club_admin'::app_role, e.club_id, NULL::uuid)
        OR has_role((SELECT auth.uid()), 'team_admin'::app_role, NULL::uuid, e.team_id)
        OR has_role((SELECT auth.uid()), 'coach'::app_role, NULL::uuid, e.team_id)
      )
  )
);

DROP POLICY IF EXISTS "Admins can manage mini league player RSVPs" ON public.rsvps;
CREATE POLICY "Admins can manage mini league player RSVPs"
ON public.rsvps
AS PERMISSIVE
FOR ALL
TO public
USING (
  (mini_league_player_id IS NOT NULL) AND (EXISTS (
    SELECT 1
    FROM mini_league_players mlp
    JOIN mini_leagues ml ON ml.id = mlp.mini_league_id
    JOIN user_roles ur ON ur.club_id = ml.club_id
    WHERE mlp.id = rsvps.mini_league_player_id
      AND ur.user_id = (SELECT auth.uid())
      AND ur.role = ANY (ARRAY['club_admin'::app_role, 'team_admin'::app_role, 'coach'::app_role])
  ))
)
WITH CHECK (
  (mini_league_player_id IS NOT NULL) AND (EXISTS (
    SELECT 1
    FROM mini_league_players mlp
    JOIN mini_leagues ml ON ml.id = mlp.mini_league_id
    JOIN user_roles ur ON ur.club_id = ml.club_id
    WHERE mlp.id = rsvps.mini_league_player_id
      AND ur.user_id = (SELECT auth.uid())
      AND ur.role = ANY (ARRAY['club_admin'::app_role, 'team_admin'::app_role, 'coach'::app_role])
  ))
);

DROP POLICY IF EXISTS "Users can view RSVPs for events they can see" ON public.rsvps;
CREATE POLICY "Users can view RSVPs for events they can see"
ON public.rsvps
AS PERMISSIVE
FOR SELECT
TO public
USING (
  (user_id = (SELECT auth.uid()))
  OR EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = rsvps.event_id
      AND (
        EXISTS (
          SELECT 1 FROM user_roles ur
          WHERE ur.user_id = (SELECT auth.uid())
            AND ur.club_id = e.club_id
        )
        OR (e.team_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM user_roles ur
          WHERE ur.user_id = (SELECT auth.uid())
            AND ur.team_id = e.team_id
        ))
        OR (e.mini_league_id IS NOT NULL AND (
          EXISTS (
            SELECT 1 FROM mini_league_admins mla
            WHERE mla.mini_league_id = e.mini_league_id
              AND mla.user_id = (SELECT auth.uid())
          )
          OR EXISTS (
            SELECT 1 FROM mini_league_players mlp
            WHERE mlp.mini_league_id = e.mini_league_id
              AND mlp.parent_user_id = (SELECT auth.uid())
          )
        ))
      )
  )
);

COMMIT;