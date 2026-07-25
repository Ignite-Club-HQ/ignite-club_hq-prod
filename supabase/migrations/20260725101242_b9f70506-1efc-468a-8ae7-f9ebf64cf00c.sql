-- =========================================================================
-- Fix two confirmed RLS defects on targeted club-wide events and their RSVPs.
--
-- Defect 1: INSERT ... RETURNING on a targeted club-wide game/social fails
--   because the current events SELECT policy routes club admins and committee
--   members through can_access_targeted_event(auth.uid(), id), which can't
--   observe the just-inserted row inside the same statement. Rewrite the
--   SELECT policy so club-level managers (app_admin, club_admin scoped to
--   events.club_id, committee_member scoped to events.club_id) are granted
--   read directly, without the event-id helper.
--
-- Defect 2: The four targeted RSVP restrictive policies use a NOT EXISTS
--   subquery against events, which is filtered by the caller's events RLS.
--   If the caller cannot see the targeted event (e.g. was removed from the
--   audience), NOT EXISTS returns true and the restrictive policy passes,
--   letting them mutate an old RSVP. Replace the subquery with a
--   SECURITY DEFINER helper that reports target_team_ids IS NOT NULL from
--   the base table regardless of caller RLS.
-- =========================================================================

-- --- Defect 2 helper -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.event_has_target_team_restriction(_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT e.target_team_ids IS NOT NULL
       FROM public.events e
      WHERE e.id = _event_id),
    false
  );
$$;

REVOKE EXECUTE ON FUNCTION public.event_has_target_team_restriction(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.event_has_target_team_restriction(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.event_has_target_team_restriction(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_has_target_team_restriction(uuid) TO service_role;

-- --- Defect 1: rewrite events SELECT policy -------------------------------
--
-- Keep every existing access branch (mini-league, club-wide, team-scoped,
-- restricted_to_roles, guardian access via can_access_targeted_event) and
-- add a direct managerial branch that does not depend on the row being
-- readable through the helper. This unblocks INSERT ... RETURNING for
-- authorised creators while preserving cross-club isolation and every
-- previously-enforced restriction.

DROP POLICY IF EXISTS "Members can view events" ON public.events;

CREATE POLICY "Members can view events"
ON public.events
FOR SELECT
USING (
  -- Direct managerial read for targeted or non-targeted club-wide events.
  -- Scoped to events.club_id so cross-club admins gain nothing.
  has_role((SELECT auth.uid()), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
  OR (
    team_id IS NULL
    AND mini_league_id IS NULL
    AND (
      has_role((SELECT auth.uid()), 'club_admin'::app_role, club_id, NULL::uuid)
      OR has_role((SELECT auth.uid()), 'committee_member'::app_role, club_id, NULL::uuid)
    )
  )
  -- Mini-league events (unchanged branch).
  OR (
    (mini_league_id IS NOT NULL)
    AND (
      has_role((SELECT auth.uid()), 'club_admin'::app_role, club_id, NULL::uuid)
      OR has_role((SELECT auth.uid()), 'league_admin'::app_role, club_id, NULL::uuid)
      OR EXISTS (
        SELECT 1 FROM mini_league_admins mla
         WHERE mla.mini_league_id = events.mini_league_id
           AND mla.user_id = (SELECT auth.uid())
      )
      OR EXISTS (
        SELECT 1 FROM mini_league_players mlp
         WHERE mlp.mini_league_id = events.mini_league_id
           AND mlp.parent_user_id = (SELECT auth.uid())
      )
    )
  )
  -- Club-wide events for ordinary eligible members (unchanged semantics).
  OR (
    (mini_league_id IS NULL)
    AND (team_id IS NULL)
    AND is_club_member((SELECT auth.uid()), club_id)
    AND (
      restricted_to_roles IS NULL
      OR cardinality(restricted_to_roles) = 0
      OR has_role((SELECT auth.uid()), 'club_admin'::app_role, club_id, NULL::uuid)
      OR has_role((SELECT auth.uid()), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
      OR EXISTS (
        SELECT 1 FROM user_roles ur
         WHERE ur.user_id = (SELECT auth.uid())
           AND ur.club_id = events.club_id
           AND ur.role = ANY (events.restricted_to_roles)
      )
    )
    AND (
      target_team_ids IS NULL
      OR can_access_targeted_event((SELECT auth.uid()), id)
    )
  )
  -- Team-scoped events (unchanged branch).
  OR (
    (team_id IS NOT NULL)
    AND (
      is_team_member((SELECT auth.uid()), team_id)
      OR has_role((SELECT auth.uid()), 'club_admin'::app_role, club_id, NULL::uuid)
      OR has_role((SELECT auth.uid()), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
    )
  )
);

-- --- Defect 2: recreate all four targeted RSVP restrictive policies -------

DROP POLICY IF EXISTS "Targeted event RSVPs require access (select)" ON public.rsvps;
DROP POLICY IF EXISTS "Targeted event RSVPs require access (insert)" ON public.rsvps;
DROP POLICY IF EXISTS "Targeted event RSVPs require access (update)" ON public.rsvps;
DROP POLICY IF EXISTS "Targeted event RSVPs require access (delete)" ON public.rsvps;

CREATE POLICY "Targeted event RSVPs require access (select)"
ON public.rsvps
AS RESTRICTIVE
FOR SELECT
USING (
  NOT public.event_has_target_team_restriction(event_id)
  OR public.can_access_targeted_event((SELECT auth.uid()), event_id)
);

CREATE POLICY "Targeted event RSVPs require access (insert)"
ON public.rsvps
AS RESTRICTIVE
FOR INSERT
WITH CHECK (
  NOT public.event_has_target_team_restriction(event_id)
  OR public.can_access_targeted_event((SELECT auth.uid()), event_id)
);

CREATE POLICY "Targeted event RSVPs require access (update)"
ON public.rsvps
AS RESTRICTIVE
FOR UPDATE
USING (
  NOT public.event_has_target_team_restriction(event_id)
  OR public.can_access_targeted_event((SELECT auth.uid()), event_id)
)
WITH CHECK (
  NOT public.event_has_target_team_restriction(event_id)
  OR public.can_access_targeted_event((SELECT auth.uid()), event_id)
);

CREATE POLICY "Targeted event RSVPs require access (delete)"
ON public.rsvps
AS RESTRICTIVE
FOR DELETE
USING (
  NOT public.event_has_target_team_restriction(event_id)
  OR public.can_access_targeted_event((SELECT auth.uid()), event_id)
);
