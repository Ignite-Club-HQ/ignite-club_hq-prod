ALTER VIEW public.competition_ladder SET (security_invoker = true);

ALTER FUNCTION public.guard_external_competition_match_edits() SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.sync_competition_result_to_events() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resync_division_scores_on_hide_toggle() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_competition_match_events() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_external_competition_match_edits() FROM anon, authenticated;