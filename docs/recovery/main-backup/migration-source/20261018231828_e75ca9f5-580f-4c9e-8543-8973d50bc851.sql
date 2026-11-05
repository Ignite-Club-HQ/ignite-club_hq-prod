ALTER TABLE public.competitions ADD COLUMN IF NOT EXISTS hide_scores boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.match_scores_hidden(_match_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.competition_matches m
    JOIN public.competitions c ON c.id = m.competition_id
    LEFT JOIN public.competition_divisions d ON d.id = m.division_id
    WHERE m.id = _match_id
      AND (c.hide_scores = true OR d.hide_scores = true)
  )
$$;

-- Toggling competition-level hide_scores must re-sync event/game_results scores,
-- same as the division toggle does.
CREATE OR REPLACE FUNCTION public.resync_competition_scores_on_hide_toggle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.hide_scores IS DISTINCT FROM OLD.hide_scores THEN
    PERFORM public.sync_competition_result_to_events_for_match(m.id)
    FROM public.competition_matches m
    WHERE m.competition_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_resync_competition_scores_on_hide_toggle ON public.competitions;
CREATE TRIGGER trg_resync_competition_scores_on_hide_toggle
AFTER UPDATE OF hide_scores ON public.competitions
FOR EACH ROW EXECUTE FUNCTION public.resync_competition_scores_on_hide_toggle();