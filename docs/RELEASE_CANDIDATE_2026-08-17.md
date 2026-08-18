# Release candidate record — 17 August 2026

**Candidate branch:** `integrate/competition-current`

**Automated-test commit:** `bca406b0c`

**Status:** automated verification passed; promotion tranche construction and
human acceptance remain pending

## Authority and scope

This is the current evidence record for the cumulative refactoring candidate.
It supersedes older candidate SHAs in historical planning and closeout notes.
It does not authorize a merge to `main` or `prod`.

The candidate is a long-running cumulative branch. At this checkpoint it is
351 commits ahead of `origin/main`, with a three-dot comparison spanning 719
files. It must not be promoted as one opaque merge.

## Exact automated evidence

The complete isolated baseline was run on 17 August 2026 with:

```text
node scripts/run-complete-baseline.mjs --approved-local-session --test-current-branch
```

Results:

| Layer | Result |
| --- | --- |
| Production TypeScript | passed (`tsconfig.production.json`) |
| Frontend Vitest | 516 files; 5,332 passed; 1 intentional skip |
| Isolated Playwright | 139/139 passed |
| Local Supabase integration | 33 files; 272/272 passed |
| Synthetic migration ledger | all 26 local migrations applied from a clean start |
| Local Supabase cleanup | passed; no allowlisted containers or data volumes remained |
| Strict feature/workflow TypeScript boundary | passed |
| Focused lint checks for changed files | passed |
| Production Vite build | passed, with recorded chunk/import warnings |

The single skip is the opt-in Babel 8 candidate acceptance gate. It runs only
when `REMAINING_SECURITY_UPGRADE_CANDIDATE=true`; it is intentionally excluded
while the application remains on the reviewed Babel 7 resolution and is not a
skipped business-behaviour test.

The table above records the checks that actually ran at this checkpoint. It does
not claim that repository-wide ESLint or the test-inclusive `tsconfig.app.json`
check is green. Those remain tracked historical debt; production compilation and
the stricter feature/workflow boundaries are the enforced compiler gates.

No hosted Supabase project, hosted frontend, real club, or real user data was
read or modified. The database portion used only the disposable
`ignite-club-local-security-tests` Docker project on `127.0.0.1`.

## Intentionally unproved by this evidence

- Physical Android and iOS device behaviour beyond the browser/WebView-like
  harnesses.
- Live push delivery, email delivery, payment providers, app stores, PlayHQ,
  Google Drive, cron schedules, hosted secrets, and third-party dashboards.
- Production capacity, restore point objectives, and a completed restore drill.
- Human visual acceptance of all refactored screens.

## Promotion decision

The automated candidate is suitable for tranche construction and human review.
It is not suitable for direct promotion. Follow
[`PROMOTION_TRANCHES_2026-08-17.md`](PROMOTION_TRANCHES_2026-08-17.md) and the
manual checklist before merging any refactoring into `main` or `prod`.
