# Roadmap — launch the live (PROD) system

Direction: move both environments **forward** onto the same current code. No rollbacks, no
reinstalls, no safeguard work below. Groups stay closed until Paul says "open groups".

## Done
- [x] DEV upgraded forward to the tested code and verified by Paul on his phone (clubs and chat working).
- [x] Account service upgraded in place on PROD to the same tested code; other 17 live services already had identical code. Data kept.
- [x] Live branch restored after the over-broad copy (all 3,477 files back, service address table intact).
- [x] Member-access tool (8 files) copied to the live branch; live branch now at `b4fb2c8b`.

## In progress
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
- [ ] **Prove the merge actually starts the canister upgrade.** `[PROD] Promote ICP canisters to
      live` is on `prod`, active, triggers on a push to `prod` touching `backend/**`/`frontend/**`,
      and the `production` environment has no approval gate — yet all 13 of its runs so far were
      started by hand. A harmless probe file pushed to `prod` at 02:33 started two runs within
      3 seconds (removed at 02:42; branch content byte-identical to before), so live-branch pushes
      do reach Actions — but the one non-skipped update carrying a `frontend/**` file (01:39,
      commit 65a6c5cf) did not start the promote job. Fix by dropping the promote job's `paths:`
      filter (the job is idempotent: run 13 finished in 40s with nothing to upgrade), or watch the
      first merge and dispatch `action=promote` by hand if it does not start.
- [ ] Onboard the first clubs.

## Parked (post-launch)
- [ ] Club deletion: build and test on DEV first, then promote.
