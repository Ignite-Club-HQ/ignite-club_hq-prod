CREATE OR REPLACE FUNCTION public.get_club_day_events(_club_id uuid, _day date)
RETURNS TABLE (
  id uuid,
  title text,
  type text,
  event_date timestamptz,
  start_time timestamptz,
  end_time timestamptz,
  location_name text,
  address text,
  suburb text,
  team_id uuid,
  team_name text,
  opponent text,
  is_cancelled boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.title, e.type::text, e.event_date, e.start_time, e.end_time,
         e.location_name, e.address, e.suburb, e.team_id, t.name AS team_name,
         e.opponent, e.is_cancelled
  FROM public.events e
  LEFT JOIN public.teams t ON t.id = e.team_id
  WHERE e.club_id = _club_id
    AND e.is_cancelled = false
    AND e.type IN ('game','training')
    AND (e.event_date AT TIME ZONE 'Australia/Adelaide')::date = _day
    AND public.is_club_member(auth.uid(), _club_id)
  ORDER BY COALESCE(e.start_time, e.event_date) ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_club_day_events(uuid, date) TO authenticated;