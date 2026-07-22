-- Integration test for scoped guardian suppression (remove_team_member RPC).
--
-- Scenario:
--   Team T in club C. Child K is on T. Parent P1 is K's biological parent.
--   Guardian P2 is linked to K via child_guardians. Admin A is club_admin of C.
--   P1 and P2 are club members (via child assignment) and therefore team members
--   too. A calls remove_team_member(T, P1). We assert:
--     1. P1 is no longer a team member.
--     2. P2 IS still a team member (other guardian unaffected).
--     3. K is still assigned to team T (child_team_assignments preserved).
--     4. child_guardians(P2, K) still present.
--     5. team_member_exclusions has the (T, P1) row.
--     6. Re-adding P1 via user_roles clears the exclusion via trigger and
--        restores membership.
--
-- Run against dev only:
--   psql "$DEV_DATABASE_URL" -f supabase/tests/scoped_member_removal_test.sql
--
-- The whole test runs in one transaction ending in ROLLBACK, so no data is
-- persisted regardless of pass/fail. Any RAISE EXCEPTION halts execution and
-- surfaces which assertion failed.

BEGIN;

DO $$
DECLARE
  _club_id   uuid := gen_random_uuid();
  _team_id   uuid := gen_random_uuid();
  _child_id  uuid := gen_random_uuid();
  _admin_id  uuid := gen_random_uuid();
  _p1_id     uuid := gen_random_uuid();
  _p2_id     uuid := gen_random_uuid();
  _rpc_result jsonb;
BEGIN
  -- ---------------------------------------------------------------------------
  -- Seed auth.users + profiles (minimum viable rows).
  -- ---------------------------------------------------------------------------
  INSERT INTO auth.users (id, email, created_at, updated_at, aud, role)
  VALUES
    (_admin_id, 'test-admin@example.invalid',  now(), now(), 'authenticated', 'authenticated'),
    (_p1_id,    'test-parent1@example.invalid', now(), now(), 'authenticated', 'authenticated'),
    (_p2_id,    'test-parent2@example.invalid', now(), now(), 'authenticated', 'authenticated');

  INSERT INTO public.profiles (id, full_name)
  VALUES
    (_admin_id, 'Test Admin'),
    (_p1_id,    'Test Parent 1'),
    (_p2_id,    'Test Parent 2');

  -- ---------------------------------------------------------------------------
  -- Seed a minimal club + team.
  -- ---------------------------------------------------------------------------
  INSERT INTO public.clubs (id, name, sport) VALUES (_club_id, 'Test Club', 'football');
  INSERT INTO public.teams (id, name, sport, club_id) VALUES (_team_id, 'Test Team', 'football', _club_id);

  -- ---------------------------------------------------------------------------
  -- Roles: admin is club_admin. P1 and P2 have NO direct user_roles; their
  -- membership is derived purely from being parent/guardian of a child on the
  -- team — which is exactly the case the fix protects.
  -- ---------------------------------------------------------------------------
  INSERT INTO public.user_roles (user_id, role, club_id)
  VALUES (_admin_id, 'club_admin'::app_role, _club_id);

  -- ---------------------------------------------------------------------------
  -- Child K: parent P1, guardian P2, assigned to team T.
  -- ---------------------------------------------------------------------------
  INSERT INTO public.children (id, parent_id, first_name, last_name)
  VALUES (_child_id, _p1_id, 'Test', 'Kid');

  INSERT INTO public.child_guardians (child_id, guardian_id)
  VALUES (_child_id, _p2_id);

  INSERT INTO public.child_team_assignments (child_id, team_id)
  VALUES (_child_id, _team_id);

  -- ---------------------------------------------------------------------------
  -- Baseline assertions.
  -- ---------------------------------------------------------------------------
  IF NOT public.is_team_member(_p1_id, _team_id) THEN
    RAISE EXCEPTION 'BASELINE FAIL: P1 should be a team member via child.parent_id';
  END IF;
  IF NOT public.is_team_member(_p2_id, _team_id) THEN
    RAISE EXCEPTION 'BASELINE FAIL: P2 should be a team member via child_guardians';
  END IF;
  IF NOT public.is_club_member(_p1_id, _club_id) THEN
    RAISE EXCEPTION 'BASELINE FAIL: P1 should be a club member';
  END IF;

  -- ---------------------------------------------------------------------------
  -- Fake the JWT so auth.uid() returns the admin, then call the RPC.
  -- ---------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', _admin_id::text, true);

  _rpc_result := public.remove_team_member(_team_id, _p1_id);
  RAISE NOTICE 'remove_team_member returned: %', _rpc_result;

  -- ---------------------------------------------------------------------------
  -- Post-removal assertions.
  -- ---------------------------------------------------------------------------
  -- 1. P1 no longer sees the team.
  IF public.is_team_member(_p1_id, _team_id) THEN
    RAISE EXCEPTION 'ASSERT FAIL 1: P1 should NOT be a team member after removal';
  END IF;

  -- 2. P2 still does.
  IF NOT public.is_team_member(_p2_id, _team_id) THEN
    RAISE EXCEPTION 'ASSERT FAIL 2: P2 (other guardian) should still be a team member';
  END IF;

  -- 3. Child still on team.
  IF NOT EXISTS (
    SELECT 1 FROM public.child_team_assignments
    WHERE child_id = _child_id AND team_id = _team_id
  ) THEN
    RAISE EXCEPTION 'ASSERT FAIL 3: child_team_assignments should be preserved';
  END IF;

  -- 4. Guardian relationship intact.
  IF NOT EXISTS (
    SELECT 1 FROM public.child_guardians
    WHERE child_id = _child_id AND guardian_id = _p2_id
  ) THEN
    RAISE EXCEPTION 'ASSERT FAIL 4: child_guardians row should be preserved';
  END IF;

  -- 5. Exclusion row present.
  IF NOT EXISTS (
    SELECT 1 FROM public.team_member_exclusions
    WHERE team_id = _team_id AND user_id = _p1_id
  ) THEN
    RAISE EXCEPTION 'ASSERT FAIL 5: team_member_exclusions row should exist for P1';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 6. Re-adding P1 via user_roles clears the exclusion via trigger.
  -- ---------------------------------------------------------------------------
  INSERT INTO public.user_roles (user_id, role, team_id)
  VALUES (_p1_id, 'coach'::app_role, _team_id);

  IF EXISTS (
    SELECT 1 FROM public.team_member_exclusions
    WHERE team_id = _team_id AND user_id = _p1_id
  ) THEN
    RAISE EXCEPTION 'ASSERT FAIL 6a: trigger should have cleared team_member_exclusions on user_roles insert';
  END IF;

  IF NOT public.is_team_member(_p1_id, _team_id) THEN
    RAISE EXCEPTION 'ASSERT FAIL 6b: P1 should be a team member again after being re-added as coach';
  END IF;

  -- ---------------------------------------------------------------------------
  -- Same scenario for the club-level RPC.
  -- ---------------------------------------------------------------------------
  -- Reset: remove P1's fresh role so we're back to derived-only membership.
  DELETE FROM public.user_roles WHERE user_id = _p1_id AND team_id = _team_id;

  IF NOT public.is_club_member(_p1_id, _club_id) THEN
    RAISE EXCEPTION 'BASELINE-CLUB FAIL: P1 should be a club member again after cleanup';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', _admin_id::text, true);
  _rpc_result := public.remove_club_member(_club_id, _p1_id);
  RAISE NOTICE 'remove_club_member returned: %', _rpc_result;

  IF public.is_club_member(_p1_id, _club_id) THEN
    RAISE EXCEPTION 'ASSERT FAIL 7: P1 should NOT be a club member after remove_club_member';
  END IF;
  IF public.is_team_member(_p1_id, _team_id) THEN
    RAISE EXCEPTION 'ASSERT FAIL 8: P1 should NOT be a team member (masked via club exclusion)';
  END IF;
  IF NOT public.is_team_member(_p2_id, _team_id) THEN
    RAISE EXCEPTION 'ASSERT FAIL 9: P2 should still be a team member after P1 removed from club';
  END IF;
  IF NOT public.is_club_member(_p2_id, _club_id) THEN
    RAISE EXCEPTION 'ASSERT FAIL 10: P2 should still be a club member';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.child_team_assignments
    WHERE child_id = _child_id AND team_id = _team_id
  ) THEN
    RAISE EXCEPTION 'ASSERT FAIL 11: child_team_assignments should be preserved through club-level removal';
  END IF;

  -- ---------------------------------------------------------------------------
  -- Authorisation check: a non-admin (P2) must NOT be able to remove members.
  -- ---------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', _p2_id::text, true);
  BEGIN
    PERFORM public.remove_team_member(_team_id, _p1_id);
    RAISE EXCEPTION 'ASSERT FAIL 12: non-admin should have been rejected';
  EXCEPTION WHEN insufficient_privilege THEN
    -- expected
    NULL;
  END;

  RAISE NOTICE 'ALL ASSERTIONS PASSED';
END;
$$;

-- Never persist test data — everything above is thrown away.
ROLLBACK;
