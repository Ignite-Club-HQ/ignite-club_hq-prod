# Roadmap

## Competition scores hard-hiding (DEV only) — DONE
- [x] Audit all home_score/away_score readers & writers
- [x] Migration: competition_match_results, RLS, grants, data move, columns dropped, hide_scores on divisions
- [x] Ladder view + trigger rewrites; officials keep score-entry rights
- [x] Settings: "Hide scores" switch per division, card renamed "Ladder & score visibility"
- [x] Fixtures panel + public page merge scores from new table; enter-score writes there
- [x] Analytics counts status='completed'; PlayHQ sync writes new table
- [x] Verified in DEV: anon blocked (API-level), admin read/write OK, ladder hides/shows, toggle off restores event scores
- [x] Typecheck + 22 competition tests pass; build OK
