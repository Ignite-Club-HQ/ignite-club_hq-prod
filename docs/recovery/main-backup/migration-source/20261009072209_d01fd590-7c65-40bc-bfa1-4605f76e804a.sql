CREATE OR REPLACE FUNCTION public.dm_block_reason(other_user_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
  support uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  any_shared boolean; any_pro boolean; any_enabled boolean; any_allowed boolean;
BEGIN
  IF me IS NULL THEN RETURN 'no_shared_club'; END IF;
  IF me = other_user_id THEN RETURN 'no_shared_club'; END IF;
  IF other_user_id = support OR me = support THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM user_roles WHERE user_id = me AND role = 'app_admin') THEN RETURN NULL; END IF;

  WITH my_clubs AS (
    SELECT ur.club_id AS club_id, ur.role::text AS role FROM user_roles ur WHERE ur.user_id = me AND ur.club_id IS NOT NULL
    UNION
    SELECT t.club_id, ur.role::text FROM user_roles ur JOIN teams t ON t.id = ur.team_id WHERE ur.user_id = me AND t.club_id IS NOT NULL
  ), their_clubs AS (
    SELECT ur.club_id AS club_id FROM user_roles ur WHERE ur.user_id = other_user_id AND ur.club_id IS NOT NULL
    UNION
    SELECT t.club_id FROM user_roles ur JOIN teams t ON t.id = ur.team_id WHERE ur.user_id = other_user_id AND t.club_id IS NOT NULL
  ), shared AS (
    SELECT DISTINCT m.club_id FROM my_clubs m JOIN their_clubs o ON o.club_id = m.club_id
  ), pro AS (
    SELECT s.club_id,
           COALESCE(d.dm_enabled, true) AS enabled,
           COALESCE(d.allowed_roles, ARRAY['app_admin','club_admin','team_admin']::text[]) AS roles
    FROM shared s
    JOIN club_subscriptions cs ON cs.club_id = s.club_id
    LEFT JOIN club_dm_settings d ON d.club_id = s.club_id
    WHERE (cs.is_pro OR cs.is_pro_football OR cs.admin_pro_override OR cs.admin_pro_football_override)
      AND (cs.expires_at IS NULL OR cs.expires_at > now())
  )
  SELECT EXISTS (SELECT 1 FROM shared),
         EXISTS (SELECT 1 FROM pro),
         EXISTS (SELECT 1 FROM pro WHERE enabled),
         EXISTS (SELECT 1 FROM pro p WHERE p.enabled AND EXISTS (
           SELECT 1 FROM my_clubs m WHERE m.club_id = p.club_id AND m.role = ANY(p.roles)))
  INTO any_shared, any_pro, any_enabled, any_allowed;

  IF any_allowed THEN RETURN NULL; END IF;
  IF NOT any_shared THEN RETURN 'no_shared_club'; END IF;
  IF NOT any_pro THEN RETURN 'no_shared_pro_club'; END IF;
  IF NOT any_enabled THEN RETURN 'dms_disabled'; END IF;
  RETURN 'role_not_allowed';
END $$;

REVOKE ALL ON FUNCTION public.dm_block_reason(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dm_block_reason(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_dm_user(other_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  me uuid := auth.uid();
  support uuid := '00000000-0000-0000-0000-000000000001'::uuid;
BEGIN
  IF me = other_user_id THEN RETURN FALSE; END IF;
  IF other_user_id = support OR me = support THEN RETURN TRUE; END IF;
  IF EXISTS (SELECT 1 FROM user_roles WHERE user_id = me AND role = 'app_admin') THEN RETURN TRUE; END IF;
  IF me IS NULL THEN RETURN FALSE; END IF;
  RETURN public.dm_block_reason(other_user_id) IS NULL;
END $$;