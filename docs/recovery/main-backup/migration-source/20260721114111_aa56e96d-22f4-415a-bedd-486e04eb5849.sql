
-- Option 2: scoped guardian suppression, so removing a member no longer
-- unassigns their child from the team (which was also cutting off other
-- guardians and the child itself).

------------------------------------------------------------------------------
-- 1. Exclusion tables
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_member_exclusions (
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  excluded_at timestamptz NOT NULL DEFAULT now(),
  excluded_by uuid,
  PRIMARY KEY (team_id, user_id)
);

GRANT SELECT ON public.team_member_exclusions TO authenticated;
GRANT ALL ON public.team_member_exclusions TO service_role;
ALTER TABLE public.team_member_exclusions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view team exclusions"
  ON public.team_member_exclusions
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'app_admin'::app_role)
    OR public.has_role(auth.uid(), 'team_admin'::app_role, NULL, team_id)
    OR EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = team_id
        AND public.has_role(auth.uid(), 'club_admin'::app_role, t.club_id)
    )
  );

CREATE TABLE IF NOT EXISTS public.club_member_exclusions (
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  excluded_at timestamptz NOT NULL DEFAULT now(),
  excluded_by uuid,
  PRIMARY KEY (club_id, user_id)
);

GRANT SELECT ON public.club_member_exclusions TO authenticated;
GRANT ALL ON public.club_member_exclusions TO service_role;
ALTER TABLE public.club_member_exclusions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view club exclusions"
  ON public.club_member_exclusions
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'app_admin'::app_role)
    OR public.has_role(auth.uid(), 'club_admin'::app_role, club_id)
  );

------------------------------------------------------------------------------
-- 2. Update membership checks to honour exclusions.
--    A user with an explicit user_roles row is normally not "excluded" because
--    the auto-clear trigger below wipes the exclusion the moment a role is
--    inserted. The exclusion clause therefore mainly filters guardian/parent-
--    derived membership.
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_team_member(_user_id uuid, _team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = _user_id AND ur.team_id = _team_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.child_team_assignments cta
      JOIN public.children c ON c.id = cta.child_id
      WHERE cta.team_id = _team_id AND c.parent_id = _user_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.child_team_assignments cta
      JOIN public.child_guardians cg ON cg.child_id = cta.child_id
      WHERE cta.team_id = _team_id AND cg.guardian_id = _user_id
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.team_member_exclusions tme
    WHERE tme.team_id = _team_id AND tme.user_id = _user_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.club_member_exclusions cme
    JOIN public.teams t ON t.id = _team_id
    WHERE cme.club_id = t.club_id AND cme.user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_club_member(_user_id uuid, _club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = _user_id AND ur.club_id = _club_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.teams t ON t.id = ur.team_id
      WHERE ur.user_id = _user_id AND t.club_id = _club_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.child_team_assignments cta
      JOIN public.teams t ON t.id = cta.team_id
      JOIN public.children c ON c.id = cta.child_id
      WHERE t.club_id = _club_id AND c.parent_id = _user_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.child_team_assignments cta
      JOIN public.teams t ON t.id = cta.team_id
      JOIN public.child_guardians cg ON cg.child_id = cta.child_id
      WHERE t.club_id = _club_id AND cg.guardian_id = _user_id
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.club_member_exclusions cme
    WHERE cme.club_id = _club_id AND cme.user_id = _user_id
  );
$$;

------------------------------------------------------------------------------
-- 3. Auto-clear exclusions when a user is (re-)added to a role.
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_member_exclusion_on_role_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.team_id IS NOT NULL THEN
    DELETE FROM public.team_member_exclusions
      WHERE team_id = NEW.team_id AND user_id = NEW.user_id;
    DELETE FROM public.club_member_exclusions cme
      USING public.teams t
      WHERE t.id = NEW.team_id
        AND cme.club_id = t.club_id
        AND cme.user_id = NEW.user_id;
  END IF;
  IF NEW.club_id IS NOT NULL THEN
    DELETE FROM public.club_member_exclusions
      WHERE club_id = NEW.club_id AND user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_member_exclusion_on_role_insert ON public.user_roles;
CREATE TRIGGER trg_clear_member_exclusion_on_role_insert
AFTER INSERT ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.clear_member_exclusion_on_role_insert();

------------------------------------------------------------------------------
-- 4. Replace remove_team_member / remove_club_member so they suppress via the
--    new exclusion tables instead of deleting child_team_assignments.
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_team_member(
  _team_id uuid,
  _user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _club_id uuid;
  _roles_removed int := 0;
  _group_members_removed int := 0;
  _exclusion_added boolean := false;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _team_id IS NULL OR _user_id IS NULL THEN
    RAISE EXCEPTION 'team_id and user_id are required' USING ERRCODE = '22004';
  END IF;

  SELECT club_id INTO _club_id FROM public.teams WHERE id = _team_id;
  IF _club_id IS NULL THEN
    RAISE EXCEPTION 'Team not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    public.has_role(_caller, 'app_admin'::app_role)
    OR public.has_role(_caller, 'club_admin'::app_role, _club_id)
    OR public.has_role(_caller, 'team_admin'::app_role, NULL, _team_id)
  ) THEN
    RAISE EXCEPTION 'Not authorised to remove members from this team'
      USING ERRCODE = '42501';
  END IF;

  -- 1. Delete scoped user_roles for this team.
  WITH d AS (
    DELETE FROM public.user_roles
     WHERE user_id = _user_id AND team_id = _team_id
     RETURNING 1
  )
  SELECT count(*) INTO _roles_removed FROM d;

  -- 2. Record a suppression so any guardian/parent-derived membership on this
  --    team is masked. Children stay on the team; other guardians unaffected.
  INSERT INTO public.team_member_exclusions (team_id, user_id, excluded_by)
  VALUES (_team_id, _user_id, _caller)
  ON CONFLICT (team_id, user_id) DO NOTHING;
  GET DIAGNOSTICS _exclusion_added = ROW_COUNT;

  -- 3. Remove group_members rows in team-scoped chat groups.
  WITH d AS (
    DELETE FROM public.group_members gm
     USING public.chat_groups cg
     WHERE gm.group_id = cg.id
       AND gm.user_id = _user_id
       AND cg.team_id = _team_id
     RETURNING 1
  )
  SELECT count(*) INTO _group_members_removed FROM d;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (
    _caller,
    'remove_team_member',
    'team',
    _team_id,
    jsonb_build_object(
      'removed_user_id', _user_id,
      'club_id', _club_id,
      'roles_removed', _roles_removed,
      'exclusion_added', _exclusion_added,
      'group_memberships_removed', _group_members_removed
    )
  );

  RETURN jsonb_build_object(
    'roles_removed', _roles_removed,
    'exclusion_added', _exclusion_added,
    'group_memberships_removed', _group_members_removed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.remove_team_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_team_member(uuid, uuid) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.remove_club_member(
  _club_id uuid,
  _user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _roles_removed int := 0;
  _group_members_removed int := 0;
  _exclusion_added boolean := false;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _club_id IS NULL OR _user_id IS NULL THEN
    RAISE EXCEPTION 'club_id and user_id are required' USING ERRCODE = '22004';
  END IF;

  IF NOT (
    public.has_role(_caller, 'app_admin'::app_role)
    OR public.has_role(_caller, 'club_admin'::app_role, _club_id)
  ) THEN
    RAISE EXCEPTION 'Not authorised to remove members from this club'
      USING ERRCODE = '42501';
  END IF;

  -- 1. Delete any user_roles for this user scoped to the club or its teams.
  WITH d AS (
    DELETE FROM public.user_roles ur
     WHERE ur.user_id = _user_id
       AND (
         ur.club_id = _club_id
         OR ur.team_id IN (SELECT t.id FROM public.teams t WHERE t.club_id = _club_id)
       )
     RETURNING 1
  )
  SELECT count(*) INTO _roles_removed FROM d;

  -- 2. Suppress guardian/parent-derived access club-wide.
  INSERT INTO public.club_member_exclusions (club_id, user_id, excluded_by)
  VALUES (_club_id, _user_id, _caller)
  ON CONFLICT (club_id, user_id) DO NOTHING;
  GET DIAGNOSTICS _exclusion_added = ROW_COUNT;

  -- 3. Remove group_members rows in any chat group scoped to this club or its teams.
  WITH d AS (
    DELETE FROM public.group_members gm
     USING public.chat_groups cg
     WHERE gm.group_id = cg.id
       AND gm.user_id = _user_id
       AND (
         cg.club_id = _club_id
         OR cg.team_id IN (SELECT t.id FROM public.teams t WHERE t.club_id = _club_id)
       )
     RETURNING 1
  )
  SELECT count(*) INTO _group_members_removed FROM d;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (
    _caller,
    'remove_club_member',
    'club',
    _club_id,
    jsonb_build_object(
      'removed_user_id', _user_id,
      'roles_removed', _roles_removed,
      'exclusion_added', _exclusion_added,
      'group_memberships_removed', _group_members_removed
    )
  );

  RETURN jsonb_build_object(
    'roles_removed', _roles_removed,
    'exclusion_added', _exclusion_added,
    'group_memberships_removed', _group_members_removed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.remove_club_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_club_member(uuid, uuid) TO authenticated, service_role;

COMMENT ON TABLE public.team_member_exclusions IS
  'When present, masks guardian/parent-derived team membership for the given user. Auto-cleared on user_roles insert for the same team (or its club).';
COMMENT ON TABLE public.club_member_exclusions IS
  'When present, masks guardian/parent-derived club membership for the given user across every team in the club. Auto-cleared on user_roles insert for the club.';
COMMENT ON FUNCTION public.remove_team_member(uuid, uuid) IS
  'Revokes a member''s access to a team: deletes user_roles for the team, adds a team_member_exclusions row so guardian-derived access is masked, and removes them from team-scoped chat groups. Children stay on the team; other guardians unaffected.';
COMMENT ON FUNCTION public.remove_club_member(uuid, uuid) IS
  'Revokes a member''s access to a club: deletes user_roles for the club and its teams, adds a club_member_exclusions row so guardian-derived access is masked, and removes them from club/team-scoped chat groups. Children remain on their teams.';
