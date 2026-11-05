# PROD migration master plan (2026-11-04)

One ordered plan for moving the live system (igniteclubhq.app + PROD Supabase + PROD
canisters) onto the current tested app. Nothing in this file has been deployed. Owner/approver:
Paul. Standing rules: structure only (no DEV data, no PROD data rewrites, one `app_settings`
config row excepted), canister upgrades are code-only, DEV and PROD stay separate.

**Governing rule (Paul, 2026-11-04): the live site must never break and users must never be
impacted.** Nothing reaches PROD until it is proven working on DEV or in isolated rehearsal.
PROD is never used to test whether something works — every phase below has a DEV/rehearsal
verification gate before its PROD step, and any failed gate stops that phase. If a live
acceptance check (Phase 4) fails, we stop and fix forward on DEV first; no live experiments,
no partial rollouts that degrade existing clubs, email logins, uploads or payments.

Detail lives in the linked docs; this file is the order of work.

## Where things stand

| Area | State |
|---|---|
| PROD canisters (18 + groups) | Same code as DEV; both groups open (router revision 6); funded |
| PROD approval snapshot | Published at revision 6 |
| Live website | Still the old Supabase-only build (no Internet Identity, no canister link) |
| PROD Supabase | Older schema; several features the new app calls are missing |
| Promotion workflows | Canister promotion: every prod push, code-only. DB promotion: structural-only, approved-only (currently only the email-signup guard) |
| Upload destination bug | Fixed in code (not live) |

## Phase 0 — Read-only checks (Paul, PROD SQL Editor; no changes)

1. Run the 5-function fingerprint SQL (`held-items-path-forward-2026-11-04.md`) — closes
   competition events + role removal if hashes match DEV.
2. Run `competition-functions-target-check.sql` — confirms the competition candidate fits PROD.
3. Export the PROD `backend_routing_config` row (values only) — needed to certify sign-in routing.
4. Confirm Netlify prod site settings (build command, base directory, branch, env vars).

Exit: all four results uploaded and compared.

## Phase 1 — Make the database ready for the new app (must precede the website switch)

Without these the new frontend regresses on PROD (see `full-app-prod-regression-audit-2026-11-04.md`).

| # | Batch | Candidate / tests | Still needed |
|---|---|---|---|
| 1 | Fixture visibility, Competition Vault access, official email invites | `competition-functions-prod-candidate.sql`; 24 SQL + 14 frontend tests passed | Phase 0 #2 result; approve 3 flagged policy expressions; fingerprint into `safe-apply-approval.json` |
| 2 | Invitation message defaults + welcome DM | `invitation-welcome-prod-candidate.sql`; 12 SQL + 24 frontend tests passed | Decide/create PROD Ignite sender profile; fingerprint |
| 3 | Profile country + club country column (no backfill) | DEV migration applied 4 Nov | DEV acceptance test; PROD candidate + fingerprint |
| 4 | Competition news admin helpers | DEV migration exists | Build PROD candidate + isolated tests; fingerprint |
| 5 | Memory reports table | DEV migration exists | Build PROD candidate; fingerprint |
| 6 | `welcome_email_settings` table (structure only, no activation) | DEV migration exists | Build candidate; fingerprint |
| — | Email-signup guard | Approved, rehearsed | Rides the merge (dormant until club list set) |

Exit: every batch registered in the approved-only inventory with Paul's sign-off; DB promotion
safe-plan shows exactly these items and nothing else.

## Phase 2 — Make the website build the canister app

1. On `prod`, change the hosting build so it produces `frontend/` (canister-connected) via
   `scripts/build-preview.mjs` / host-build-env, with PROD-scoped Supabase + canister IDs; refuse DEV IDs.
2. Confirm production context requires the `prod` branch; `main` stays DEV.
3. Get the red full-suite / publication tests green (audit lists them).

Exit: a local PROD-context build contains Internet Identity, PROD canister IDs and the revision-6 approval, and no DEV IDs.

### Phase 2 status (2026-11-05)
- Done: hosting build already targets `frontend/` with branch-scoped PROD settings. Added stops: PROD build fails if any of the 18 live service IDs is missing/wrong, or if `routingGates.ts` is not PROD's approved snapshot. Club lookup no longer hard-codes the DEV club service.
- Trial PROD-context build: all 18 PROD IDs, PROD database and Internet Identity present.
- Merge warning: when merging main into prod, keep prod's own `frontend/src/live/generated/routingGates.ts` (PROD revision 6) if GitHub reports a conflict; the build now refuses DEV's copy.
- Open: phone apps default secure sign-in to the DEV frontend bridge (`IGNITE_LIVE_NATIVE_II_BRIDGE_ORIGIN` unset for PROD; no PROD frontend canister yet). Web sign-in on igniteclubhq.app is unaffected. Needs a PROD frontend canister before Codemagic PROD builds use secure sign-in.

## Phase 3 — The merge (Paul runs main → prod in GitHub)

Automatic on push:
- `[PROD] Promote ICP canisters to live` — code-only, changed canisters only (expected no-change).
- `[DB] Promote to Prod` — applies only approved structural batches from Phase 1.
- Hosting rebuild of igniteclubhq.app.

Confirm for the exact merge commit: both workflows succeeded (not skipped), hosting published after them.

## Phase 4 — Live acceptance (Paul, real accounts; test data only with explicit approval)

1. Bridgewater / Basket Range: existing email logins, password reset, sessions still work.
2. Internet Identity sign-in on igniteclubhq.app; profile not re-requested for existing users.
3. Create a club; teams; send an invitation; accept it; welcome message appears.
4. Upload a photo and a chat file; read them back; open a document.
5. Competition: fixtures visible to the right people only; Vault opens for managers.
6. Payments / Pro access still resolve.
7. Native apps (Codemagic prod) point at PROD and pass the same smoke test.

Exit: all pass; any failure → stop, no data fixes without approval.

## Phase 5 — Switch on held settings (separate approval each)

1. Email-club list: one PROD `app_settings` row with PROD club IDs, then one invited signup test.
2. Reminder / welcome-email jobs: schedules + secrets.
3. Competition document storage area (private bucket) + Competition Vault uploads.
4. Edge-function activation per `post-merge-edge-function-activation`.
5. ICP push notifications (DEV first, then PROD): see `icp-push-setup-post-merge-2026-11-04.md`.

## Phase 6 — Post-launch (parked)

- Hidden scores: structure first, then separately approved archived copy (never clear scores).
- Free-media cleanup + its scheduled job.
- AI score review (deferred).
- Club deletion: build/test on DEV, then promote.
- Onboard first clubs once Phase 4 passes.

## Who does what

| Step | Paul | Agent |
|---|---|---|
| Phase 0 | Run SQL, upload CSVs, read Netlify settings | Prepare SQL, compare results |
| Phase 1 | Approve each batch | Build/test candidates, register fingerprints |
| Phase 2 | Approve build change | Implement, test |
| Phase 3 | Run the merge | Verify workflow runs |
| Phase 4–5 | Test live, approve each switch | Prepare checklists/tools |

## Source docs

`full-app-prod-regression-audit-2026-11-04.md`, `prod-follow-up-checklist-2026-11-04.md`,
`held-items-path-forward-2026-11-04.md`, `remaining-feature-compatibility-2026-11-04.md`,
`competition-functions-build-2026-11-04.md`, `invitation-welcome-build-2026-11-04.md`,
`photo-file-upload-fix-2026-11-04.md`, `supabase-promotion-safety-2026-11-04.md`,
`prod-db-classification-2026-11-04.md`, `../../roadmap.md`.

### Phase 0 results (5 Nov 2026)
1. Function fingerprints: all 5 match DEV — closed.
2. Competition target check: existing items identical to DEV; only candidate additions missing — fits.
3. backend_routing_config: was absent; Paul inserted the one allowed config row (Bridgewater + Basket Range email clubs, same IDs as DEV); readback matches DEV exactly.
4. Netlify prod site settings: closed — repository `Ignite-Club-HQ/ignite-club_hq-prod`,
   production branch `prod`, branch deploys limited to the production branch,
   `VITE_SUPABASE_PUBLISHABLE_KEY` present and scoped to Production, and
   `PROD_RELEASE_READ_TOKEN` added by Paul (Builds scope, Production context only)
   so the live build's promotion-evidence check can read workflow results.
   The dashboard's Base `/`, command `bun run build` and Publish `dist` are inert:
   `netlify.toml` in the repository overrides the UI for those settings.

### Phase 2 status (5 Nov 2026) — complete, rides the merge

`main` already carries everything the live build needs, so the merge delivers it:

- `netlify.toml`: base `frontend`, publish `dist-live`, command
  `node ../scripts/host-build-env.mjs`, prod/dev deploy-context environments,
  `/api/*` redirects, `ii-alternative-origins` served as JSON, security headers.
- Build scripts: `host-build-env.mjs`, `icp-environments.mjs`,
  `prod-publication-gate.mjs`, `prod-connection-check-policy.mjs`,
  `prod-hybrid-build.mjs`, `ensure-frontend-deps.mjs`.
- Endpoint handlers `frontend/netlify/functions/{fetch-link-preview,register-club-backend}.mjs`.
- `frontend/public/.well-known/ii-alternative-origins` with the four approved origins.

Two merge-time notes:

1. If `netlify.toml` conflicts, take **main's** version (the new live config).
   `routingGates.ts` is the opposite: keep **prod's** version there.
2. The live build runs the promotion-evidence check at build start, and it can
   lose the race against the two promotion workflows that the same push starts.
   If the deploy fails with "Production promotion evidence unavailable" or
   "... has not succeeded for this commit", the previous live site stays up
   (safe). Re-trigger the deploy from Netlify once both workflows are green.

## Phase 1 owner decisions (Paul, 5 Nov 2026)
- Approved: batch 1 fixture visibility, 2 Vault access, 3 official email invites (`competition-functions-prod-candidate.sql`), 4 invitation message defaults.
- Batch 5 welcome DM: approved, conditional on PROD read-only check that the fixed Ignite Support sender profile exists; sender creation is not approved.
- Remaining before merge: register approved SQL in the fingerprinted release inventory; post-merge live tests with Paul-chosen test accounts.

## Phase 1 registration (5 Nov 2026) — complete

The five approved batches are now real migration files in `supabase/migrations/`,
split one file per approved batch so each can be held or applied on its own:

| Batch | File |
| --- | --- |
| 1 fixture visibility | `20261105000000_competition_fixture_visibility.sql` |
| 2 Vault access | `20261105000100_competition_vault_access.sql` |
| 3 official email invites | `20261105000200_competition_role_email_invites.sql` |
| 4 invitation message defaults | `20261105000300_club_invite_message_defaults.sql` |
| 5 welcome direct message | `20261105000400_send_welcome_dm.sql` |

Their bytes are the two reviewed candidate files split without edits, enforced by
a test that rebuilds each candidate from the batch files.

Registered inventory (all fingerprinted, `sha256`):

- `safe-release-manifest.json` — 45 sources: 11 candidates, 34 held.
- `safe-apply-approval.json` — 6 approved migrations (signup check + the five
  batches), owner `Paul Cranwell`, target `yabcfiuntwqjwvschnji`.
- `safe-apply-reviewed-findings.json` — 5 owner-reviewed structural-check findings
  (1 on fixture visibility, 2 on email invites, 2 on invitation defaults covering
  10 occurrences). Any finding this ledger does not carry still stops the release,
  and editing a file invalidates its recorded review.

Verification: 38 release-safety tests pass; both rehearsal suites pass against the
exact migration bytes (24 competition-function tests, 12 invitation/welcome tests)
on disposable socket-only databases. The PROD sender-profile existence check came
back `true`/`true`, so batch 5's condition is met.

Nothing has run against the live database. Batch 5's `CREATE FUNCTION` and the held
`20261104040343_f83a6a5c-8bb9-43a8-b65e-cb020f2a9363.sql` both define
`public.send_welcome_dm`; only one may ever be applied, and the held file stays held.

### Pre-existing script test failures (unrelated to these batches)

The full `scripts/*.test.mjs` run shows 12 failures. All 12 were re-run with the
five new migration files removed and the manifest and approval restored to their
pre-registration state, and all 12 failed identically there, so none is caused by
this registration:

- `auth-exact-staging.test.mjs` (3) and `smaller-release-review.test.mjs` (2) —
  guards holding a hard-coded 38-file migration inventory; the tree already had 40
  files before this registration.
- `prod-release-review.test.mjs` (2) — owner-export evidence expecting the same
  38-file inventory.
- `assemble-smaller-runtime.test.mjs` (1) — needs an extracted production source.
- `canister-health.test.mjs` (1) — reads live canister fuel and memory over HTTPS.
- `group-general-opening-workflow.test.mjs` (2) — `PROD is not defined` and
  `process is not defined` inside the test's own evaluated snippets.
- `workflow-env-names.test.mjs` (1) — PROD-claim allowlist drift.

These need their own cleanup pass; none of them gates the merge, and none touches
the safe-apply path that carries the six approved batches.

## Triple-check correction — 5 November 2026

**Do not merge yet.** Registration readiness is not full-app readiness. This section
supersedes the earlier unconditional merge recommendation and the statement that all
remaining failures are unrelated cleanup.

Read-only GitHub evidence: main `b807998d1ccf0e216369e168d0cbe2ce1ab58c80`, prod
`904fa6e58e8745ecddb624c77fed33a0fd7fdd7b`; source-check run `41939926187` failed.
No application source, backend, permissions, deployment, or production data changed.

### Confirmed work before recommending the merge

1. **Frontend source check is red:** hosted `typecheck:product` reports 68 new
   TypeScript parse diagnostics from generated contract parameters named `new`,
   including live club_domain bindings. The build step was skipped. Fix the
   generator/output compatibility on DEV and require the same hosted check green;
   do not hide the errors by refreshing its baseline.
2. **Release-policy CI is red:** exact CI test command locally reproduced 27 passes
   and one failure in `workflow-env-names.test.mjs` (a PROD protection signing-key
   workflow lacks the expected explicit prod-ref text). In addition, `ci.yml`
   unconditionally exits for PRs targeting prod, saying database evidence remains
   unintegrated. Resolve these using the existing approved release mechanism;
   do not override failed checks to force a merge. The branch protection endpoint
   reports no classic protection; this does not certify absence of rulesets or safety.
3. **Existing profile editing regresses:** `EditProfilePage.tsx:323–344` always
   includes `country` in Supabase updates, even when editing only the name/avatar.
   Recorded PROD evidence says `profiles.country` is absent; none of the approved
   six migrations adds it. Supply a tested compatibility-safe frontend write or
   separately approved structural column before publication. Existing login reads
   do not require this column, so this is not a claim that all logins fail.

### Evidence gaps / merge-time and separately held scope

- The PROD routing row exists and was owner-verified, but SQL Editor reads do not
  prove anonymous boot access. Approved SQL does not add its anonymous policy.
  Verify cold signed-out access to this one row without exposing other settings;
  absence is not established by this audit.
- Competition-news authorization/helpers remain only partially catalogued;
  confirm compatible existing RLS/functions or explicitly defer that surface.
  `clubs.country` is not an active dependency (current creation uses home_country),
  and missing memory reports are contained admin diagnostics, not core blockers.
- Remote PROD backend mapping has 18 IDs; approved routing snapshot is revision 6.
  Preserve its entire file even if a merge reports no conflict, plus all PROD
  mappings; take main's netlify.toml. An actual merged tree has not been tested.
- Remote `deploy/frontend-prod/.icp/data/mappings/ic.ids.json` is absent. The
  frontend-canister job uses a floating `ref: prod` and `icp deploy --mode auto`.
  Do not equate Netlify website readiness with authorization to create a canister
  or native secure-sign-in readiness; resolve that separate target/release scope.
- Netlify token/public-key scoping is owner-reported, not independently read here;
  future exact-merge-commit DB/backend promotion evidence cannot exist before merge.
  Keep the established wait/retry publication procedure.

### Reverification passed

- Exact inventory: 45 originals, 11 candidates, 34 held; six approved files and all
  recorded hashes match. The reviewed-finding ledger covers 13 occurrences across
  five distinct entries. Unreviewed findings still stop application.
- Database direct gates: 39 passed; approved and isolated signup rehearsals: 2
  passed; exact competition SQL: 24 passed; invitation/welcome SQL: 12 passed.
- Website/environment/promotion targeted checks: 49 passed. Email-policy checks:
  3 passed. These do not negate the current hosted CI failure or prove live flows.
- Welcome sender positive check remains Paul's supplied true/true result.
  Database transactions are per-file, not one transaction for the complete six;
  later failure may leave earlier structural batches committed while hosting holds.

Production remains unchanged. Authenticated PROD uploads, retained-email-club
flows, physical-phone calendar acceptance and separately approved activation work
remain unverified; do not present local rehearsals as hosted acceptance.
