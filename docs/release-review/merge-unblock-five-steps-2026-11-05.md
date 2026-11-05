# Five-step merge unblocking — 5 November 2026

## Result

DEV/offline fixes are complete and tested where access permits. **Do not merge yet:** the final GitHub source run and two bounded production evidence/access items remain. No production data, schema, permissions, canisters, hosting settings or store releases were changed.

### 1. Website source checks

GitHub run **41942118585**, commit `55a293e052bfd6fcae1280857811c922a606e1ed`, confirmed the lab-generated repair, lint and Candid checks. Its product typecheck then found exactly four remaining reserved-name diagnostics in `frontend/src/live/generated/club_domain/club_domain.ts`. Those two parameter labels are now corrected. Syntax coverage includes lab bindings, lab generated-contracts and live/generated; all four tests pass. The next synchronized main commit must pass the complete hosted source workflow. Rerunning an old run would test old bytes; no such rerun was requested and no local full build/typecheck was run.

### 2. Release policy

Both key creation and verification workflows now explicitly enforce the prod branch. The old blanket PR failure was replaced by `supabase-safe-source-check.mjs`, which uses the existing complete manifest, protected-source policy, six-file approval, reviewed findings and SQL AST parser. It reports **45 originals / 6 approved / 34 held**, denies deployment and target verification, and does not use credentials or contact a database. Actual ledger validation remains in the existing promotion executor; publication still requires real successful exact-commit deployment jobs. Approval files/hashes and SQL unchanged.

### 3. Profile saving

`profileSave.ts` preserves display name, avatar and leaderboard preference on schemas without country. Edit Profile separately probes its own optional country field because auth boot selects legacy columns only. Only precise PGRST204/42703 country-column rejection permits one retry without country; permission/transport/other-column errors propagate. Country UI/cache follows actual support/save acknowledgement. No column migration or data backfill added. Authenticated hosted UI save cannot be certified with this project's external unmanaged Supabase session; focused save tests and existing auth regression pass.

### 4. Production evidence/access

A bounded anonymous request using the public anon key extracted from the actual live website returned:

- `app_settings`, key `backend_routing_config`, limit 1: HTTP 200, **0 rows**.
- Unrelated settings keys, limit 1: HTTP 200, **0 rows**.

This proves the row is not visible to signed-out visitors now; it does not distinguish current absence from RLS hiding. Paul's earlier SQL Editor readback reported the row exists. Run the adjacent bounded read-only evidence query before any change. If the row exists and the policies hide it, the known minimal candidate is the three-statement public-routing policy already in source (`20261004045741...sql`): grant SELECT to anon, recreate one SELECT policy using `key='backend_routing_config'`. **Do not execute or add to the six-file approval without fresh owner approval and confirmation that other anon policies cannot expose unrelated keys.** No grants changed here.

Competition-news catalog is better than the previous summary suggested: PROD has `target_competition_id` (the field the UI uses), authenticated grants, competition admin SELECT/INSERT/UPDATE/DELETE policies, `club_news_competition_ids(uuid)`, `validate_club_news_audience()` and its enabled trigger, plus `notify_club_news`. The missing `club_news.competition_id` is not the UI's field. Missing helper names alone do not prove broken policy behavior because PROD has its own policy implementation. The actual ICP feed/post path is in `features/news/useClubNews.ts` via `features/club`, not solely the old announcement adapter. No speculative adapter rewrite was made. The existing cold competition-post and audience tests pass, but actual PROD function/policy bodies and hosted caller authorization still require evidence. The adjacent query retrieves only these definitions/columns/grants, not business rows.

### 5. Separate publications

Kept the existing backend promotion on **every prod push**, without path filters. Frontend-canister publication now requires a separate manual `publish_frontend=true` choice, defaults false, checks out the dispatch SHA, rejects absent/empty mapping before signing/canister operations, starts only its mapped frontend and deploys with `--mode upgrade`. It never creates, reinstalls or commits a new mapping. Netlify website deployment remains separate and unchanged.

The PROD backend mapping readback contains 18 services; approved PROD routing snapshot is revision 6 with base + g2. **Retain both complete PROD files during merging, even without reported conflicts.** Use main's Netlify config. Remote PROD frontend mapping remains absent (404), so frontend publication remains blocked rather than creating one.

Both Codemagic store workflows now require `NATIVE_APPROVED_COMMIT` to equal their full `CM_COMMIT` on prod before promotion evidence/build steps. Set it only for a separately approved phone release. Store workflow identities/signing/integrations remain unchanged. Phone builds still need an explicitly verified PROD native II bridge origin; the current default is DEV. Neither missing frontend mapping nor phone acceptance is silently declared fixed; both remain held independently of website preparation.

## Verification

- Consolidated release/policy/publication tests: **108/108 pass**.
- Native/version/publication subset: **34/34 pass**.
- Profile/auth/news subset: **27/27 pass** (9 new profile tests).
- Generated syntax: **4/4 pass**; changed page/helper parse without diagnostics.
- Competition exact-SQL rehearsal: **24/24 pass**; invitation/welcome: **12/12 pass**, socket-only disposable local clusters.
- Scoped source CI lint: pass. Changed YAML parses successfully.
- DEV `/auth` renders, no page errors; preview build log reports build OK.

## Remaining actions

1. Read the final synchronized commit's hosted source result and fix any new diagnostics it reveals.
2. Paul runs `merge-unblock-read-only-evidence.sql` in PROD SQL Editor; no writes. If public routing is hidden, obtain narrow access-repair approval before changing policy.
3. Review bounded competition-news definitions against existing implementation/rehearsal; do not infer authorization from a catalog hash or empty signed-out feed.
4. Review the actual proposed merge retaining PROD mappings/snapshot and main Netlify settings. Do not merge or publish until the remaining confirmed blockers are resolved.