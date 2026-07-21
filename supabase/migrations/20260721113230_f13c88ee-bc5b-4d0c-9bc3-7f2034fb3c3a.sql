
-- Scoped member removal RPCs. Fixes a defect where "Remove Member" only
-- deleted user_roles but left the removed guardian/parent with derived
-- access via child_guardians + child_team_assignments.

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
  _assignments_removed int := 0;
  _group_members_removed int := 0;
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

  -- Authorisation: app_admin, club_admin of this club, or team_admin of this team.
  IF NOT (
    public.has_role(_caller, 'app_admin'::app_role)
    OR public.has_role(_caller, 'club_admin'::app_role, _club_id)
    OR public.has_role(_caller, 'team_admin'::app_role, NULL, _team_id)
  ) THEN
    RAISE EXCEPTION 'Not authorised to remove members from this team' USING ERRCODE = '42501';
  END IF;

  -- 1. Delete scoped user_roles for this team.
  WITH d AS (
    DELETE FROM public.user_roles
     WHERE user_id = _user_id AND team_id = _team_id
     RETURNING 1
  )
  SELECT count(*) INTO _roles_removed FROM d;

  -- 2. Remove child_team_assignments for children this user parents or guardians,
  --    but ONLY for this team. Guardian relationships and other-team assignments
  --    are preserved.
  WITH d AS (
    DELETE FROM public.child_team_assignments cta
     WHERE cta.team_id = _team_id
       AND cta.child_id IN (
         SELECT c.id FROM public.children c WHERE c.parent_id = _user_id
         UNION
         SELECT cg.child_id FROM public.child_guardians cg WHERE cg.guardian_id = _user_id
       )
     RETURNING 1
  )
  SELECT count(*) INTO _assignments_removed FROM d;

  -- 3. Remove group_members rows for this user in chat groups scoped to this team.
  WITH d AS (
    DELETE FROM public.group_members gm
     USING public.chat_groups cg
     WHERE gm.group_id = cg.id
       AND gm.user_id = _user_id
       AND cg.team_id = _team_id
     RETURNING 1
  )
  SELECT count(*) INTO _group_members_removed FROM d;

  -- 4. Audit log.
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
      'child_assignments_removed', _assignments_removed,
      'group_memberships_removed', _group_members_removed
    )
  );

  RETURN jsonb_build_object(
    'roles_removed', _roles_removed,
    'child_assignments_removed', _assignments_removed,
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
  _assignments_removed int := 0;
  _group_members_removed int := 0;
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
    RAISE EXCEPTION 'Not authorised to remove members from this club' USING ERRCODE = '42501';
  END IF;

  -- 1. Delete any user_roles for this user scoped to this club, or scoped to any
  --    team belonging to this club.
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

  -- 2. Remove child_team_assignments for children this user parents or guardians,
  --    but only for teams within this club. child_guardians is preserved.
  WITH d AS (
    DELETE FROM public.child_team_assignments cta
     USING public.teams t
     WHERE cta.team_id = t.id
       AND t.club_id = _club_id
       AND cta.child_id IN (
         SELECT c.id FROM public.children c WHERE c.parent_id = _user_id
         UNION
         SELECT cg.child_id FROM public.child_guardians cg WHERE cg.guardian_id = _user_id
       )
     RETURNING 1
  )
  SELECT count(*) INTO _assignments_removed FROM d;

  -- 3. Remove group_members rows for this user in any chat group scoped to this
  --    club or to a team within it.
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
      'child_assignments_removed', _assignments_removed,
      'group_memberships_removed', _group_members_removed
    )
  );

  RETURN jsonb_build_object(
    'roles_removed', _roles_removed,
    'child_assignments_removed', _assignments_removed,
    'group_memberships_removed', _group_members_removed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.remove_club_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_club_member(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.remove_team_member(uuid, uuid) IS
  'Atomically revokes a member''s team access: deletes user_roles for the team, unassigns their children from the team (own + guardianed), and removes them from team-scoped chat groups. Preserves child_guardians and access to other teams.';

COMMENT ON FUNCTION public.remove_club_member(uuid, uuid) IS
  'Atomically revokes a member''s club access: deletes user_roles for the club and its teams, unassigns their children from all teams in the club, and removes them from club/team-scoped chat groups. Preserves child_guardians relationships.';
