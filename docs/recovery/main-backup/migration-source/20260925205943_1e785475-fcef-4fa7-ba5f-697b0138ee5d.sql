CREATE OR REPLACE FUNCTION public.remove_team_member(_team_id uuid, _user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _club_id uuid;
  _roles_removed int := 0;
  _group_members_removed int := 0;
  _exclusion_added boolean := false;
  _target_name text;
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

  WITH d AS (
    DELETE FROM public.user_roles
     WHERE user_id = _user_id AND team_id = _team_id
     RETURNING 1
  )
  SELECT count(*) INTO _roles_removed FROM d;

  INSERT INTO public.team_member_exclusions (team_id, user_id, excluded_by)
  VALUES (_team_id, _user_id, _caller)
  ON CONFLICT (team_id, user_id) DO NOTHING;
  GET DIAGNOSTICS _exclusion_added = ROW_COUNT;

  WITH d AS (
    DELETE FROM public.group_members gm
     USING public.chat_groups cg
     WHERE gm.group_id = cg.id
       AND gm.user_id = _user_id
       AND cg.team_id = _team_id
     RETURNING 1
  )
  SELECT count(*) INTO _group_members_removed FROM d;

  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _user_id;

  INSERT INTO public.audit_logs (action_type, actor_id, target_user_id, target_user_name, details)
  VALUES (
    'remove_team_member',
    _caller,
    _user_id,
    _target_name,
    jsonb_build_object(
      'team_id', _team_id,
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
$function$;

CREATE OR REPLACE FUNCTION public.remove_club_member(_club_id uuid, _user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _roles_removed int := 0;
  _group_members_removed int := 0;
  _exclusion_added boolean := false;
  _target_name text;
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

  INSERT INTO public.club_member_exclusions (club_id, user_id, excluded_by)
  VALUES (_club_id, _user_id, _caller)
  ON CONFLICT (club_id, user_id) DO NOTHING;
  GET DIAGNOSTICS _exclusion_added = ROW_COUNT;

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

  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _user_id;

  INSERT INTO public.audit_logs (action_type, actor_id, target_user_id, target_user_name, details)
  VALUES (
    'remove_club_member',
    _caller,
    _user_id,
    _target_name,
    jsonb_build_object(
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
$function$;