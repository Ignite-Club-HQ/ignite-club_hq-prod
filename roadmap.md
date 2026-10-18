# Roadmap

## Competition scores hard-hiding (DEV only)
- [ ] Audit all home_score/away_score readers & writers (frontend, RPCs, edge functions)
- [ ] Migration: create competition_match_results, RLS (division hide_scores / comp admin), grants, migrate data, drop columns from competition_matches, add hide_scores to competition_divisions
- [ ] Settings page: "Hide scores" switch per division (rename card "Ladder & score visibility")
- [ ] Frontend: fixtures panel + public comp page fetch scores from new table, merge by match_id, show "vs" when hidden
- [ ] Enter-score flow writes to new table
- [ ] Ladder RPCs + analytics + PlayHQ sync read/write new table
- [ ] Tests (a)-(k): admin visibility, fixture nav, finals placeholders, hide-scores enforcement incl. anon API
- [ ] Typecheck + existing tests; verify in DEV with real accounts
