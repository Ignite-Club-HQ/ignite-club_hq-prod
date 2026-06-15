DROP FUNCTION IF EXISTS public.get_team_competition_names(uuid[]);

CREATE FUNCTION public.get_team_competition_names(_team_ids uuid[])
 RETURNS TABLE(team_id uuid, competition_id uuid, competition_name text, competition_logo_url text, competition_sport text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ON (ce.team_id) ce.team_id, c.id, c.name, c.logo_url, c.sport
  FROM public.competition_entries ce
  JOIN public.competitions c ON c.id = ce.competition_id
  WHERE ce.team_id = ANY(_team_ids)
    AND ce.status IN ('accepted', 'invited')
  ORDER BY ce.team_id,
           CASE ce.status WHEN 'accepted' THEN 0 ELSE 1 END,
           c.created_at DESC
$function$;

REVOKE ALL ON FUNCTION public.get_team_competition_names(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_team_competition_names(uuid[]) TO authenticated;