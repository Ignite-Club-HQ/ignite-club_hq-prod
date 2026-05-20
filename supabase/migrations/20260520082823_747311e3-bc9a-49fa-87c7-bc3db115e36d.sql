CREATE OR REPLACE FUNCTION public.get_messages_page_bootstrap(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_app_admin boolean;
  _is_committee boolean;
  _admin_club_ids uuid[];
  _admin_team_ids uuid[];
  _all_roles jsonb;
  _member_club_ids uuid[];
  _member_team_ids uuid[];
  _all_club_ids uuid[];
  _pro_club_ids uuid[];
  _pro_team_ids uuid[];
  _admin_clubs jsonb;
  _club_pro_status jsonb;
BEGIN
  SELECT
    COALESCE(bool_or(role::text = 'app_admin'), false),
    COALESCE(bool_or(role::text = 'committee_member'), false),
    COALESCE(array_agg(DISTINCT club_id) FILTER (WHERE role::text = 'club_admin' AND club_id IS NOT NULL), ARRAY[]::uuid[]),
    COALESCE(array_agg(DISTINCT team_id) FILTER (WHERE role::text IN ('team_admin','coach','committee_member') AND team_id IS NOT NULL), ARRAY[]::uuid[]),
    COALESCE(jsonb_agg(jsonb_build_object('role', role, 'club_id', club_id, 'team_id', team_id)), '[]'::jsonb),
    COALESCE(array_agg(DISTINCT club_id) FILTER (WHERE club_id IS NOT NULL), ARRAY[]::uuid[]),
    COALESCE(array_agg(DISTINCT team_id) FILTER (WHERE team_id IS NOT NULL), ARRAY[]::uuid[])
  INTO
    _is_app_admin, _is_committee, _admin_club_ids, _admin_team_ids,
    _all_roles, _member_club_ids, _member_team_ids
  FROM public.user_roles
  WHERE user_id = _user_id;

  SELECT COALESCE(array_agg(DISTINCT c), ARRAY[]::uuid[])
  INTO _all_club_ids
  FROM (
    SELECT unnest(_member_club_ids) AS c
    UNION
    SELECT t.club_id FROM public.teams t
      WHERE t.id = ANY(_member_team_ids) AND t.club_id IS NOT NULL
  ) s;

  SELECT COALESCE(array_agg(DISTINCT club_id), ARRAY[]::uuid[])
  INTO _pro_club_ids
  FROM public.club_subscriptions
  WHERE club_id = ANY(_all_club_ids)
    AND (is_pro OR is_pro_football OR admin_pro_override OR admin_pro_football_override)
    AND (expires_at IS NULL OR expires_at > now());

  SELECT COALESCE(array_agg(DISTINCT team_id), ARRAY[]::uuid[])
  INTO _pro_team_ids
  FROM public.team_subscriptions
  WHERE team_id = ANY(_member_team_ids)
    AND (is_pro OR is_pro_football OR admin_pro_override OR admin_pro_football_override)
    AND (expires_at IS NULL OR expires_at > now());

  -- Full admin club rows (id, name, logo_url, sport), excluding soft-deleted.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'logo_url', c.logo_url,
      'sport', c.sport
    )), '[]'::jsonb)
  INTO _admin_clubs
  FROM public.clubs c
  WHERE c.id = ANY(_admin_club_ids)
    AND c.deleted_at IS NULL;

  -- Per-member-club Pro status map { club_id: boolean }.
  SELECT COALESCE(jsonb_object_agg(cid, is_pro_now), '{}'::jsonb)
  INTO _club_pro_status
  FROM (
    SELECT
      cid,
      EXISTS (
        SELECT 1 FROM public.club_subscriptions s
        WHERE s.club_id = cid
          AND (s.is_pro OR s.is_pro_football OR s.admin_pro_override OR s.admin_pro_football_override)
          AND (s.expires_at IS NULL OR s.expires_at > now())
      ) AS is_pro_now
    FROM unnest(_member_club_ids) AS cid
  ) m;

  RETURN jsonb_build_object(
    'is_app_admin', _is_app_admin,
    'is_committee_member', _is_committee,
    'admin_club_ids', to_jsonb(_admin_club_ids),
    'admin_team_ids', to_jsonb(_admin_team_ids),
    'all_roles', _all_roles,
    'member_club_ids', to_jsonb(_member_club_ids),
    'member_team_ids', to_jsonb(_member_team_ids),
    'pro_club_ids', to_jsonb(_pro_club_ids),
    'pro_team_ids', to_jsonb(_pro_team_ids),
    'has_any_pro', (COALESCE(array_length(_pro_club_ids, 1),0) > 0 OR COALESCE(array_length(_pro_team_ids, 1),0) > 0),
    'admin_clubs', _admin_clubs,
    'club_pro_status', _club_pro_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_messages_page_bootstrap(uuid) TO authenticated;