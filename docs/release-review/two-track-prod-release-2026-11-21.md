# Ignite PROD release split — 21 November 2026

## Status
**DRAFT PREPARATION ONLY. No merge, PROD push, canister upgrade, SQL execution, group/identity settings change or production web publication is approved.**

The broad `main -> prod` draft PR #1627 spans 507 changed files and includes DEV backend, security, discovery and release features. Its source CI is green, but the independent PROD read-only routing gate failed because the separate production admission/deletion release has not been completed. Do not equate green source checks with safe PROD deployment.

## Release 1 — compatible application UX (this branch)

Base this narrow release on the existing `prod` branch, **not** `main`. Stage only:
1. The post-team-creation web handoff offering the existing branded iOS/Android links after the newly created team has actually loaded, retaining the user sign-in method and warning users on preview/DEV hosts that test accounts will not appear in PROD stores.
2. Club-day event-list de-duplication for two mirror records representing the same match, preserving rematches at different times.
3. Focused regression tests and CI steps covering the two behaviors.
4. **Existing PROD/DEV native push target safety correction**: hold registration to the unapproved second member-group queue until release 2, preserving the existing PROD Base push path. Previously the production client referenced the DEV G2 queue, now explicitly blocked by tests.
5. The existing manual PROD all-member push workflow now permits **inspect** and exact-confirmed **emergency disable** only, never enable. Its governor script verifies the pinned PROD Base/G2 queues against the governor-signed committed production snapshot **before** creating network actors. The failed exact-workflow allowlist now recognises that one manual workflow only while asserting these protections. No push state is changed in preparation.

The existing `AppStoreDownloadGuide` and `/get/ios`, `/get/android` links already exist on `prod`; do not introduce external redirects, signup actions, payment events, canister writes or new endpoints.

**Expected changed files:** the earlier seven frontend/CI/review files plus six push-safety files: `frontend/src/live/icpPushMode.ts`, `frontend/src/live/icpPushMode.test.ts`, `scripts/prod-native-push-rollout.mjs`, `scripts/prod-native-push-rollout.test.mjs`, `.github/workflows/prod-native-push-rollout.yml`, `scripts/workflow-env-names.test.mjs`. Total: **13**.

### Hold points before any production merge

- Confirm current PROD base commit, exact file list and CI (source tests, typecheck, frontend build, security checks, Supabase/ICP compatibility). Never waive the CI guard. The pending PROD push hold does not authorize enabling multi-group notifications.
- Read and approve the precise PR diff. Confirm there are **no** backend/`.did`/SQL/PROD topology or canister mapping changes. The two native-push client/operator files are intentionally narrower than full G2 push functionality.
- PROD merges auto-trigger `[PROD] Promote ICP canisters to live` (may upgrade canisters and publish frontend), `[DB] Promote to Prod` (safe-apply on push), and hosting deployment. A "frontend-only diff" is **not** a guarantee the workflow has no PROD side effects.
- Require production owner to review the deployment runbook, active consumers, release receipt, database dry-plan, existing auth/PII/member experience, cycle reserves and rollback before allowing `prod` merge. No automated auto-merge or manual promotion is authorised by this PR.
- After explicit release approval, verify signup, creating a team, team access, events, Supabase mode, existing ICP Base/G2 reads, branded store links, and native app compatibility. If source checks pass but infrastructure attestation is insufficient, keep this PR Draft.

## Release 2 — backend/infrastructure, *later*

**Do not ship by automatically merging PR #1627.** Create a newly reviewed, targeted backend release after separately approving exact canister source changes and compatibility. Candidate changes include:
- Combined caller-scoped club membership/role IPC method from DEV PR #1620 (new Candid and canister binary; not safe as frontend-only).
- Account admission and deletion protections, DEV-first-content canister upgrades, group-specific identity/PII permissions and any new backend reads/notifications required by other UI features.
- Separate production enablement for both Base and G2, only after audited negative/positive authorization and rollback acceptance.

The native-push source initially misidentified PROD G2 as DEV G2 `zu4gk-…`; the correct PROD G2 queue is `vnmx4-…`, confirmed by the committed PROD routing snapshot and supplied live gate audit. Release 1 never attempts cross-group phone registration, and the all-member activation remains held. **Release 2 must separately review notification canister code and the dedicated push sender and re-enable only after verified PROD admission, modules and readback.**

The 20 November 2026 live PROD closed-group admission gate observed configuration revision 7 with groups Base and G2; the original `routingGates.ts` `registryRevision=6` is a different counter. It reported some canisters below the 1T registered minimum (total 2,717,912,882,359 cycles), 12 Base service identity bindings missing, production member-admission OFF and unverified bound-deletion release. **Do not close active groups, copy DEV flags or fill missing settings simply to make this gate green.** First decide which controls belong to the separately approved infrastructure rollout. Cycles amounts need a fresh read-only plan and signing-account availability assessment before any independent funded action.

## ChatGPT plugin distribution caveat

The Ignite ChatGPT DEV skill pilot depends on the separately managed official DFINITY ICP connector and actual per-user Internet Identity authorization. Shipping frontend UX **does not** publish the DEV ChatGPT plugin, install ICP connector integrations for production customers, or confer DFINITY/plugin approval. Track those distribution prerequisites independently.

## Reference
- Original broad draft: https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/pull/1627
- Production routing audit findings recorded on: https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/pull/1627#issuecomment-7049576724
