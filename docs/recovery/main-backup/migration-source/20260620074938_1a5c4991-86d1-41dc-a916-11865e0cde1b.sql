CREATE OR REPLACE FUNCTION public.get_team_competition_names(_team_ids uuid[])
RETURNS TABLE(
  team_id uuid,
  competition_id uuid,
  competition_name text,
  competition_logo_url text,
  competition_sport text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH visible_competitions AS (
    SELECT
      ce.team_id,
      c.id AS competition_id,
      c.name AS competition_name,
      c.logo_url AS competition_logo_url,
      c.sport AS competition_sport,
      CASE ce.status WHEN 'accepted' THEN 0 ELSE 1 END AS sort_rank,
      c.created_at
    FROM public.competition_entries ce
    JOIN public.competitions c ON c.id = ce.competition_id
    WHERE ce.team_id = ANY(_team_ids)
      AND ce.status IN ('accepted', 'invited')

    UNION

    SELECT
      t.id AS team_id,
      c.id AS competition_id,
      c.name AS competition_name,
      c.logo_url AS competition_logo_url,
      c.sport AS competition_sport,
      2 AS sort_rank,
      c.created_at
    FROM public.teams t
    JOIN public.competitions c ON c.id = t.playhq_competition_id
    WHERE t.id = ANY(_team_ids)
      AND t.playhq_competition_id IS NOT NULL
      AND c.source = 'playhq'

    UNION

    SELECT
      t.id AS team_id,
      c.id AS competition_id,
      c.name AS competition_name,
      c.logo_url AS competition_logo_url,
      c.sport AS competition_sport,
      3 AS sort_rank,
      c.created_at
    FROM public.teams t
    JOIN public.competitions c ON c.organizer_club_id = t.club_id
    WHERE t.id = ANY(_team_ids)
      AND c.source = 'playhq'
      AND c.status = 'active'
  )
  SELECT DISTINCT ON (vc.team_id, vc.competition_id)
    vc.team_id,
    vc.competition_id,
    vc.competition_name,
    vc.competition_logo_url,
    vc.competition_sport
  FROM visible_competitions vc
  ORDER BY vc.team_id, vc.competition_id, vc.sort_rank, vc.created_at DESC
$function$;

REVOKE ALL ON FUNCTION public.get_team_competition_names(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_team_competition_names(uuid[]) TO authenticated;