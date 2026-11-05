# Roadmap — launch the live (PROD) system

## Current pre-merge verdict — 5 November 2026 triple-check
- [x] Rechecked exact six approved database migrations: 39 safety tests, 2 signup rehearsals, 24 competition and 12 invitation/welcome rehearsal tests passed; 45 original hashes/inventory valid. No PROD execution.
- [ ] Current request: fix the 68 website source-check diagnostics caused by generated parameter `new`, add syntax regression coverage, and rerun source/release checks; no PROD changes. Hosted recheck is required before readiness.
- [ ] Resolve the reproduced workflow-env-names test failure (27/28 pass) and the unconditional PROD pull-request hold in ci.yml through the existing reviewed release path, not a bypass.
- [ ] Preserve existing Supabase profile saves when PROD lacks profiles.country: current EditProfilePage always writes it; the six approved migrations do not add it. Requires tested compatibility fix or separately approved structure.
- [ ] Verify anonymous access to only backend_routing_config on PROD; SQL Editor row readback proves existence, not signed-out access. Do not assume approved migrations grant it.
- [ ] Review actual merged tree: retain the entire PROD routingGates.ts and PROD deployment mappings; take main netlify.toml. Keep unresolved competition-news compatibility explicitly scoped.
- [ ] Separate PROD frontend-canister/native release decision: expected frontend mapping is absent remotely; current frontend job uses mode auto and floating prod checkout. Website readiness does not authorize new canister creation or certify native secure sign-in.

This verdict supersedes stale readiness/blocker descriptions below. No main-to-prod merge is recommended until the confirmed source/CI/profile blockers are resolved; live permissions/acceptance remain evidence limitations, not proven failures.

Direction: move both environments **forward** onto the same current code. No rollbacks, no
reinstalls, no safeguard work below. Groups stay closed until Paul says "open groups".

## Done
- [x] DEV upgraded forward to the tested code and verified by Paul on his phone (clubs and chat working).
- [x] Account service upgraded in place on PROD to the same tested code; other 17 live services already had identical code. Data kept.
- [x] Live branch restored after the over-broad copy (all 3,477 files back, service address table intact).
- [x] Member-access tool (8 files) copied to the live branch; live branch now at `b4fb2c8b`.

## In progress
- [x] Repair reproduced notification/inbox/photo test failures and verify all four reported areas: 40 Supabase/34 ICP tests passed; 43 related files per mode passed (450/425 tests). Event-group failures not reproduced; no source change needed there. Full-suite rerun not included; no PROD changes. See docs/release-review/test-failure-repairs-2026-11-04.md.
- [x] Calendar export frontend repair: native cache→FileOpener→Share→visible error, Google option, club-zone UTC, public links and byte folding; 25 calendar/menu tests and 21 related read tests passed (5 mode skips), helper tests also pass in Los Angeles/Tokyo. See docs/release-review/calendar-export-verification-2026-11-04.md.
- [ ] Calendar physical acceptance before promotion: single event and whole schedule on real iPhone/Android, correct saved times and working links; blocked on physical devices/local synced DEV build and authenticated access. After approved release repeat on both phones. No database, notification, RSVP or PROD-data changes authorized.
- [x] Build invitation-default/welcome-DM PROD candidate: 12 exact-SQL tests and 24 frontend tests passed (1 mode skip). See docs/release-review/invitation-welcome-build-2026-11-04.md; existing invitation lifecycle unchanged, no hosted writes.
- [ ] Deploy defaults/welcome and test a real club invitation end-to-end: blocked on PROD deployment/session access, exact schema/policy review, approved-only migration registration and fixed Ignite sender readiness. Candidate not yet executable or included in merge approval.
- [x] Build standalone PROD fixture/Vault/email-official SQL; 24 exact-SQL isolated tests and 14 frontend tests passed (15 mode skips). See docs/release-review/competition-functions-build-2026-11-04.md. Scores, old links and role/chat triggers untouched; candidate not deployed.
- [ ] Deploy/test competition functions live: blocked on authorized PROD connection/session, exact manager/policy review, three structural expression approvals and candidate registration in approved-only migration inventory. Existing signup-only release approval unchanged. Competition Vault uploads remain separately blocked.
- [x] Fix photo/file destination: restored authenticated environment-bound Storage callbacks, removed purchase-service redirect; 58 tests passed, 13 mode-specific skips. See docs/release-review/photo-file-upload-fix-2026-11-04.md. No hosted writes or permission changes.
- [ ] Verify authenticated PROD upload/readback; competition-vault remains blocked by bucket/access dependencies and DEV service-only policy. Workspace has no PROD authenticated session; transport tests are not hosted acceptance.
- [x] Deep full-app pre-promotion regression audit saved: docs/release-review/full-app-prod-regression-audit-2026-11-04.md. Verdict: do not promote whole frontend yet.
- [ ] Resolve full-app release blockers before main→prod: authenticated media acceptance (destination repaired); missing fixture visibility, competition Vault, official email invites, invite defaults and admin tables; routing-row and edge-function evidence; red full/publication suites; authenticated email-club acceptance. Requires implementation decisions and PROD-authorized verification.
- [x] Supabase promotion source assurance: 41 release/publication tests, 42 email-policy tests and exact-approved-SQL isolated PostgreSQL regression passed; regression added before deployment in workflow. See docs/release-review/supabase-promotion-safety-2026-11-04.md.
- [ ] Full-app promotion assurance remains blocked on current PROD routing-row verification and authenticated retained-email-club flows; resolve missing fixture visibility/Vault/invitation dependencies before claiming a break-free frontend release. Catalog exports do not prove the signup guard is dormant. No PROD writes made.
- [x] Compare remaining Supabase feature migrations against PROD evidence (Paul uploaded the expanded PROD catalog 4 Nov ~05:58 UTC; 1,515 rows). Results saved in docs/release-review/remaining-feature-compatibility-2026-11-04.md: real gaps = welcome DM + profile country, invitation message defaults, competition news admin helpers, competition vault access functions, official email invites, memory reports; competition events present but version uncertain; role removal present; scores/AI/free-media stay held. No deployment or data writes.
- [ ] Prepare DEV-tested, safe-only releases for the confirmed PROD gaps (welcome DM + profile country first), each with owner approval before merge. Consolidated checklist: docs/release-review/prod-follow-up-checklist-2026-11-04.md (gaps, held items, pending decisions).
- [x] Held items path forward written: docs/release-review/held-items-path-forward-2026-11-04.md.
- [ ] Paul runs the 5-function fingerprint check on PROD (closes competition events + role removal if matching DEV).
- [ ] After live site rebuild: PROD-only email-club settings row with PROD club IDs, then one invited sign-up test.
- [ ] Decide: create Ignite team sender account on PROD (welcome message stays silent without it).
- [ ] Post-launch, separate approvals: hidden scores (structure, then archived copy), free-media cleanup + job, reminder/welcome-email activation, competition document storage area, AI review.
- [ ] Six-candidate fresh PROD compatibility check requested: source effects documented and catalog-only query prepared. Blocked on PROD SQL Editor export; workspace Supabase access is DEV-only, and live workflow has no read-only catalog mode. GitHub inspection only; no workflow dispatch or database writes. See docs/release-review/six-candidate-compatibility-2026-11-04.md.
- [x] Added exact safe-only staging to the existing database workflow: complete original hashes, separate candidates/holds, read-only manual safe-plan default and offline source checks. 34 focused tests passed, including a fixture end-to-end runner check proving no write command runs; workflow YAML validated. Originals and full push-release gates remain unchanged; no history repair or live deployment.
- [ ] Safe-only execution remains held: obtain fresh exact PROD target definitions/dependency evidence, rehearse target-specific SQL, and approve the exact application mechanism before enabling an executor. Current safe-plan reports six initial candidates and never deploys.
- [x] Fixed protected-source mismatch using six exact non-executable held sources; archive
      never substitutes for applied/mismatched executable SQL or suppresses pending source.
      Run 41765096598 automatically completed successfully: 0 migrations, 0 edge functions.
      43 focused tests passed. Current prod had no pending changes; no data or schema changed.
- [x] Rebuilt structural-only Supabase promotion on main/prod; 42 focused tests passed.
      Automatic push run 41764557107 passed source tests and read the live migration ledger,
      then stopped before ALL writes: prod lacks six fingerprint-protected 30 October
      migration source files named in main's release policy. No schema/functions/data changed.
      An initial attempt failed GitHub context validation before any job; corrected locally/prod.
- [ ] Before releasing main's changes, review its complete pending migration plan; successful
      no-change PROD run does not approve main's blocked migrations. Do not execute held DEV SQL,
      fabricate applied history, or relax fingerprints to force a green run.
- [x] Read-only Supabase merge check: both branches trigger on prod pushes without path filters.
      PROD run 41761473545 completed real migration/function deployment steps successfully.
      Main carries a different workflow: tests followed by an unconditional release-hold exit 1.
      Existing release-safety tests: 15 passed. No database commands or deploys performed by this check.
- [x] Replaced divergent Supabase workflows with the same structural-only runner; legacy
      history/credential/cron repairs removed. Release remains held by source/evidence issues above.
      Promotion covers committed migrations/functions, not arbitrary DEV dashboard changes,
      secrets, authentication settings or DEV data.
      Paul reaffirmed: schema, edge-function code, RLS and grants only; no DEV data copying
      or business-row changes, and existing PROD data must remain intact.
- [x] Refreshed PROD's approval and read back snapshot revision 6 for both groups; run 41758472686 succeeded without dispatching publication.
- [x] Existing PROD Netlify config builds the legacy root app with `npm run build`; provider auto-deploy settings remain unverified.

## Next
- [ ] Follow the ordered PROD migration plan: docs/release-review/prod-migration-master-plan-2026-11-04.md (Phase 0 read-only checks → DB batches → website build → merge → live tests → held switches).
- [x] Funding account topped up and ordinary member access commissioned.
- [x] Both PROD groups opened with Paul's approval and live readback.
- [ ] **Merge `main` into `prod` so the live site connects to the canisters.** igniteclubhq.app
      still serves the legacy build (Supabase-only, no Internet Identity, no opening approval).
      The canister-connected frontend lives on `main`; merging it to `prod` is what makes the
      live site use the canisters. The prod Netlify build currently runs `npm run build` on the
      legacy root app, so the merge must also leave the prod build producing the canister app.
      Verify after merge: the served bundle contains Internet Identity and the PROD routing
      approval, then sign in at igniteclubhq.app and create a club.
- [x] Removed promotion's path filter on main and prod with Paul's approval. Exact one-line
      PROD workflow change read back; commit 765ce195 automatically started push-event run
      41762901542 (no manual dispatch). Focused isolation/trigger tests: 14 passed.
- [ ] At the first main→prod merge, confirm promotion succeeds for that exact merge commit;
      upgrades remain code-only and DEV/PROD data separate.
- [ ] Onboard the first clubs.

## Parked (post-launch)
- [ ] Club deletion: build and test on DEV first, then promote.
- [ ] Safe live database release: scope approved; read-only staging implemented for all 39 originals, with six initial candidates and 33 holds. Blocked on fresh PROD target definitions/dependency evidence, exact SQL acceptance and an approved application mechanism; staging is not a selective deployment executor. Scores, country backfills, reminder activation and AI remain excluded; private storage creation has no separate approval yet. See docs/release-review/safe-release-staging.md.
- [ ] Hidden-score change (20261021003048 + 20261021003143) cannot reach the live database through a merge in any form: the structural checker rejects both files (57 + 1 findings) because copying scores and emptying the old columns are data writes. Releasing it later needs structure first, then a separately approved data run that copies scores and keeps an archive. Verified the copy is lossless and the app already reads scores from the protected table.

- [ ] Release hybrid welcome message + profile country (DEV applied 4 Nov) to PROD via main→prod merge; needs PROD Ignite team account (system profile) for welcome message to send.
- [ ] Merge main→prod to send the approved email sign-up check live (approved-only release; blocked on Paul running the merge). Live check only refuses sign-ups once the live email-club settings entry exists.
