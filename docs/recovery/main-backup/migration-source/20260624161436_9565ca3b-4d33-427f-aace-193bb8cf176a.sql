CREATE OR REPLACE FUNCTION public.club_engagement_total_unique_reach(_club_id uuid, _start timestamptz, _end timestamptz)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _caller uuid := auth.uid();
  _is_app_admin boolean;
  _is_club_admin boolean;
  _reach integer;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id = _caller AND role = 'app_admin') INTO _is_app_admin;
  IF _club_id IS NULL THEN
    IF NOT _is_app_admin THEN RAISE EXCEPTION 'Forbidden'; END IF;
  ELSE
    SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id = _caller AND club_id = _club_id AND role IN ('club_admin','committee_member')) INTO _is_club_admin;
    IF NOT (_is_app_admin OR _is_club_admin) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  END IF;

  SELECT COUNT(DISTINCT sa.user_id)::int INTO _reach
  FROM sponsor_analytics sa
  JOIN sponsors s ON s.id = sa.sponsor_id
  WHERE sa.user_id IS NOT NULL
    AND sa.created_at BETWEEN _start AND _end
    AND s.is_active
    AND (_club_id IS NULL OR s.club_id = _club_id);

  RETURN COALESCE(_reach, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.club_engagement_total_unique_reach(uuid, timestamptz, timestamptz) TO authenticated, service_role;