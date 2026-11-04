# Roadmap — launch the live (PROD) system

Direction: move both environments **forward** onto the same current code. No rollbacks, no
reinstalls, no safeguard work below. Groups stay closed until Paul says "open groups".

## Done
- [x] DEV upgraded forward to the tested code and verified by Paul on his phone (clubs and chat working).
- [x] Account service upgraded in place on PROD to the same tested code; other 17 live services already had identical code. Data kept.
- [x] Live branch restored after the over-broad copy (all 3,477 files back, service address table intact).
- [x] Member-access tool (8 files) copied to the live branch; live branch now at `b4fb2c8b`.

## In progress
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
