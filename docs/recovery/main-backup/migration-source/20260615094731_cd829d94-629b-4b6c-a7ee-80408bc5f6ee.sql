CREATE OR REPLACE FUNCTION public.get_team_competition_names(_team_ids uuid[])
RETURNS TABLE(team_id uuid, competition_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (ce.team_id) ce.team_id, c.name
  FROM public.competition_entries ce
  JOIN public.competitions c ON c.id = ce.competition_id
  WHERE ce.team_id = ANY(_team_ids)
    AND ce.status IN ('accepted', 'invited')
  ORDER BY ce.team_id,
           CASE ce.status WHEN 'accepted' THEN 0 ELSE 1 END,
           c.created_at DESC
$$;

GRANT EXECUTE ON FUNCTION public.get_team_competition_names(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_competition_names(uuid[]) TO anon;