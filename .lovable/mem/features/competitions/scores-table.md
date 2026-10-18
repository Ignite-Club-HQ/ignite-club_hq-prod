---
name: Competition scores live in competition_match_results
description: competition_matches has no home_score/away_score columns; scores live in competition_match_results with RLS hard-hiding per division (competition_divisions.hide_scores). Never re-add score columns to competition_matches.
type: constraint
---
Scores for competition fixtures live ONLY in `public.competition_match_results` (match_id PK, home_score, away_score, entered_by). `competition_matches` has no score columns — do not re-add them.

Rules:
- Reads: merge results by match_id after fetching matches (see CompetitionFixturesPanel / PublicCompetitionPage). Missing row = show "vs"/"–", never error.
- Writes: upsert into competition_match_results (onConflict match_id). RLS allows competition Owners/Admins and officials (is_competition_official); PlayHQ sync uses service_role and skips manually_overridden matches.
- Hiding: `competition_divisions.hide_scores` is enforced by RLS via SECURITY DEFINER `match_scores_hidden(match_id)` — policy subqueries can't be used because the hiding row is itself RLS-invisible to outsiders.
- Propagation: trigger `sync_competition_result_to_events` copies scores to events.final_score_* and game_results, and BLANKS them when the division hides scores; toggling hide_scores re-syncs via `resync_division_scores_on_hide_toggle`.
- Ladder: `competition_ladder` view joins the results table and excludes hidden-score matches for non-admins.
- Analytics "results entered" counts matches with status='completed'.
