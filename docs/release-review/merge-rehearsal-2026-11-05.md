# Practice merge (main into prod) — 5 November 2026

Nothing merged into `prod`; no live data, database or services changed.

## What was built
- Branch `merge-rehearsal-2026-11-05`, commit `bc4232da`, parents prod `904fa6e5` + main `41aabbde`.
- Draft PR #1412 into `prod` (do not merge) to run GitHub checks.
- GitHub's automatic merge refused (real conflicts), so the tree was resolved by hand:
  - 25 files changed on both sides. In 24 the prod copy was an older snapshot of main's file (prod lacked newer lines, e.g. opt-in frontend publication, safe-apply mode, newer witness checks). Main's version taken.
  - `frontend/src/live/generated/routingGates.ts`: prod kept (live router `tgfbl-…`, revision 6, base + g2).
  - Prod-only additions kept: `deploy/prod/.icp/data/mappings/ic.ids.json`, `deploy/prod/release.json`, 11 leftover `backend/*/main.did` files (harmless; ignored by checks).
  - `netlify.toml`: main.
  - 1,135 old root migration files: removed, as on main. Prod never changed them. Removing source files does not touch database rows or migration history. The database promotion reads only main's 46-file reviewed list and applies only the six owner-approved files.

## GitHub results on bc4232da
- Website check (`frontend`): passed. Canister check (`rust-canisters`): passed.
- Database deployment: skipped (correct for a merge request).
- `auth-release-policy` and `Structural release tests`: **failed**, same cause: the small/growing plans migration (`20261105030600_…`) was missing from `docs/release-review/safe-release-manifest.json`, so the release inventory check refused (45 listed vs 46 files).
- `deliver-private-name-approval.yml` push run failed instantly, as it already does on main (known, unrelated).

## Fix (on main)
- Added that migration to the manifest as **hold**, because Paul already added both plans live via SQL editor (readback confirmed). Held count updated 34 → 35 in three tests.
- Local: 42/42 release tests pass with the real SQL parser; `supabase-safe-source-check.mjs` reports 46 originals, 6 approved, 35 held.

## Next
1. Rebuild the practice merge on the new main commit (same resolution) and rerun PR checks.
2. If all green, Paul merges that PR (or main into prod with the same keep-rules).
