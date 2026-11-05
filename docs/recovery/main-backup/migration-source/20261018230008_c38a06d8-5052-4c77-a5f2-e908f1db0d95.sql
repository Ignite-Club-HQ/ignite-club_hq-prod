CREATE OR REPLACE FUNCTION public.match_scores_hidden(_match_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT d.hide_scores
    FROM public.competition_matches m
    JOIN public.competition_divisions d ON d.id = m.division_id
    WHERE m.id = _match_id
  ), false)
$$;

DROP POLICY "scores readable unless division hides them" ON public.competition_match_results;

CREATE POLICY "scores readable unless division hides them"
ON public.competition_match_results FOR SELECT
USING (
  NOT public.match_scores_hidden(match_id)
  OR public.is_competition_admin(auth.uid(), (
    SELECT m2.competition_id FROM public.competition_matches m2 WHERE m2.id = match_id
  ))
);