CREATE OR REPLACE FUNCTION public.club_engagement_active_users(
  _club_id uuid,
  _start timestamptz,
  _end timestamptz
)
RETURNS TABLE(day date, user_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    has_role(auth.uid(), 'app_admin'::app_role)
    OR has_role(auth.uid(), 'club_admin'::app_role, _club_id, NULL)
    OR has_role(auth.uid(), 'committee_member'::app_role, _club_id, NULL)
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  WITH members AS (
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.club_id = _club_id AND ur.user_id IS NOT NULL
  )
  SELECT DISTINCT (l.started_at AT TIME ZONE 'UTC')::date AS day, l.user_id
  FROM public.user_activity_logs l
  JOIN members m ON m.user_id = l.user_id
  WHERE l.started_at >= _start
    AND l.started_at <= _end;
END;
$$;