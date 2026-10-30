-- ============================================================================
-- Targeted club-wide events — authorization boundary
-- Forward-only. Does NOT edit deployed migrations.
-- ============================================================================

-- 1. Tighten validation trigger: require >= 2 distinct team ids, reject [].
CREATE OR REPLACE FUNCTION public.validate_event_target_team_ids()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  arr_len int;
  distinct_len int;
  bad_count int;
BEGIN
  -- NULL = all-club mode, always allowed.
  IF NEW.target_team_ids IS NULL THEN
    RETURN NEW;
  END IF;

  arr_len := COALESCE(array_length(NEW.target_team_ids, 1), 0);

  -- Reject empty arrays: the frontend never submits [] as a persisted
  -- value; [] is an editing-mode marker only.
  IF arr_len = 0 THEN
    RAISE EXCEPTION 'target_team_ids must contain at least 2 teams (received empty array)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Reject single-team targeting (use events.team_id instead).
  IF arr_len < 2 THEN
    RAISE EXCEPTION 'target_team_ids must contain at least 2 teams — use events.team_id for a single team'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Reject duplicate ids in the array.
  SELECT count(DISTINCT tid) INTO distinct_len
    FROM unnest(NEW.target_team_ids) AS tid;
  IF distinct_len <> arr_len THEN
    RAISE EXCEPTION 'target_team_ids must not contain duplicate team ids'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.team_id IS NOT NULL THEN
    RAISE EXCEPTION 'target_team_ids can only be set on club-wide events (team_id must be null)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.type NOT IN ('game','social') THEN
    RAISE EXCEPTION 'target_team_ids is only supported for game or social events'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.club_id IS NULL THEN
    RAISE EXCEPTION 'target_team_ids requires a club_id'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO bad_count
  FROM unnest(NEW.target_team_ids) AS tid
  LEFT JOIN public.teams t ON t.id = tid
  WHERE t.id IS NULL OR t.club_id <> NEW.club_id;

  IF bad_count > 0 THEN
    RAISE EXCEPTION 'target_team_ids contains teams that do not belong to the event club'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- 2. SECURITY DEFINER helper: authorization boundary for targeted events.
--    Fully scoped to (_user_id, event's club, target teams). No arbitrary
--    membership enumeration.
CREATE OR REPLACE FUNCTION public.can_access_targeted_event(
  _user_id uuid,
  _event_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ev_club uuid;
  ev_targets uuid[];
  ev_restricted public.app_role[];
BEGIN
  IF _user_id IS NULL OR _event_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT e.club_id, e.target_team_ids, e.restricted_to_roles
    INTO ev_club, ev_targets, ev_restricted
    FROM public.events e
   WHERE e.id = _event_id;

  IF ev_club IS NULL THEN
    RETURN false;
  END IF;

  -- App admins & event managers always allowed.
  IF public.has_role(_user_id, 'app_admin'::public.app_role, NULL::uuid, NULL::uuid) THEN
    RETURN true;
  END IF;
  IF public.has_role(_user_id, 'club_admin'::public.app_role, ev_club, NULL::uuid) THEN
    RETURN true;
  END IF;
  IF public.has_role(_user_id, 'committee_member'::public.app_role, ev_club, NULL::uuid) THEN
    RETURN true;
  END IF;

  -- No targeting: fall back to existing club-wide visibility (club member,
  -- honouring restricted_to_roles).
  IF ev_targets IS NULL THEN
    IF NOT public.is_club_member(_user_id, ev_club) THEN
      RETURN false;
    END IF;
    IF ev_restricted IS NULL OR cardinality(ev_restricted) = 0 THEN
      RETURN true;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = _user_id
         AND ur.club_id = ev_club
         AND ur.role = ANY(ev_restricted)
    );
  END IF;

  -- Targeted: caller must belong to (or coach/admin of, or guardian into)
  -- one of the targeted teams.
  IF EXISTS (
    SELECT 1
      FROM unnest(ev_targets) AS tid
     WHERE public.is_team_member(_user_id, tid)
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.user_roles ur
     WHERE ur.user_id = _user_id
       AND ur.team_id = ANY(ev_targets)
       AND ur.role IN ('team_admin'::public.app_role, 'coach'::public.app_role)
  ) THEN
    RETURN true;
  END IF;

  -- Guardian path: any authorized guardian of a child assigned to one of
  -- the targeted teams.
  IF EXISTS (
    SELECT 1
      FROM public.child_guardians cg
      JOIN public.child_team_assignments cta ON cta.child_id = cg.child_id
     WHERE cg.guardian_id = _user_id
       AND cta.team_id = ANY(ev_targets)
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.can_access_targeted_event(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_access_targeted_event(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_access_targeted_event(uuid, uuid) TO authenticated;

-- 3. Rewrite events SELECT policy: keep existing branches, add
--    target_team_ids enforcement to the club-wide branch.
DROP POLICY IF EXISTS "Members can view events" ON public.events;
CREATE POLICY "Members can view events"
  ON public.events
  FOR SELECT
  USING (
    -- Mini-league branch (unchanged)
    (
      mini_league_id IS NOT NULL
      AND (
        has_role((SELECT auth.uid()), 'club_admin'::app_role, club_id, NULL::uuid)
        OR has_role((SELECT auth.uid()), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
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
    -- Club-wide branch: club member + restricted_to_roles honoured, AND
    -- when target_team_ids is set the caller must pass the targeted-event
    -- authorization check.
    OR (
      mini_league_id IS NULL
      AND team_id IS NULL
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
             AND ur.role = ANY(events.restricted_to_roles)
        )
      )
      AND (
        target_team_ids IS NULL
        OR public.can_access_targeted_event((SELECT auth.uid()), events.id)
      )
    )
    -- Team branch (unchanged)
    OR (
      team_id IS NOT NULL
      AND (
        is_team_member((SELECT auth.uid()), team_id)
        OR has_role((SELECT auth.uid()), 'club_admin'::app_role, club_id, NULL::uuid)
        OR has_role((SELECT auth.uid()), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
      )
    )
  );

-- 4. Tighten rsvps: block mutations for targeted events by non-targeted
--    users. Additive policies — existing ownership/guardian policies still
--    apply; the new RESTRICTIVE policies add an authorization AND.
-- Postgres semantics: a row must pass ALL restrictive policies AND at
-- least one permissive policy. This lets us layer targeting without
-- rewriting the existing suite.
DROP POLICY IF EXISTS "Targeted event RSVPs require access (select)" ON public.rsvps;
CREATE POLICY "Targeted event RSVPs require access (select)"
  ON public.rsvps
  AS RESTRICTIVE
  FOR SELECT
  USING (
    NOT EXISTS (
      SELECT 1 FROM public.events e
       WHERE e.id = rsvps.event_id
         AND e.target_team_ids IS NOT NULL
    )
    OR public.can_access_targeted_event((SELECT auth.uid()), rsvps.event_id)
  );

DROP POLICY IF EXISTS "Targeted event RSVPs require access (insert)" ON public.rsvps;
CREATE POLICY "Targeted event RSVPs require access (insert)"
  ON public.rsvps
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    NOT EXISTS (
      SELECT 1 FROM public.events e
       WHERE e.id = rsvps.event_id
         AND e.target_team_ids IS NOT NULL
    )
    OR public.can_access_targeted_event((SELECT auth.uid()), rsvps.event_id)
  );

DROP POLICY IF EXISTS "Targeted event RSVPs require access (update)" ON public.rsvps;
CREATE POLICY "Targeted event RSVPs require access (update)"
  ON public.rsvps
  AS RESTRICTIVE
  FOR UPDATE
  USING (
    NOT EXISTS (
      SELECT 1 FROM public.events e
       WHERE e.id = rsvps.event_id
         AND e.target_team_ids IS NOT NULL
    )
    OR public.can_access_targeted_event((SELECT auth.uid()), rsvps.event_id)
  )
  WITH CHECK (
    NOT EXISTS (
      SELECT 1 FROM public.events e
       WHERE e.id = rsvps.event_id
         AND e.target_team_ids IS NOT NULL
    )
    OR public.can_access_targeted_event((SELECT auth.uid()), rsvps.event_id)
  );

DROP POLICY IF EXISTS "Targeted event RSVPs require access (delete)" ON public.rsvps;
CREATE POLICY "Targeted event RSVPs require access (delete)"
  ON public.rsvps
  AS RESTRICTIVE
  FOR DELETE
  USING (
    NOT EXISTS (
      SELECT 1 FROM public.events e
       WHERE e.id = rsvps.event_id
         AND e.target_team_ids IS NOT NULL
    )
    OR public.can_access_targeted_event((SELECT auth.uid()), rsvps.event_id)
  );