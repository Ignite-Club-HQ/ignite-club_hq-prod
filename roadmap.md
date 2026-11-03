# Roadmap — launch the live (PROD) system

Direction: move both environments **forward** onto the same current code. No rollbacks, no
reinstalls, no safeguard work below. Groups stay closed until Paul says "open groups".

## Done
- [x] DEV upgraded forward to the tested code and verified by Paul on his phone (clubs and chat working).
- [x] Account service upgraded in place on PROD to the same tested code; other 17 live services already had identical code. Data kept.
- [x] Live branch restored after the over-broad copy (all 3,477 files back, service address table intact).
- [x] Member-access tool (8 files) copied to the live branch; live branch now at `b4fb2c8b`.

## In progress
- [ ] Buy 5 trillion fuel for the funding account that supplies all 18 live services.
      Payment ID `prod-fuel-20261104-01`, run 41724788201.
      **Blocker: Paul must open the run and pay the Stripe link (about US$7.30) within 85 minutes.**
      If it lapses, reconcile that same payment ID — never create a second order.

## Next
- [ ] Commission ordinary member access on PROD so signed-in members can use live clubs.
- [ ] Port the "open group to everyone" tool from DEV to the live branch (it exists only on DEV today),
      then open the PROD groups so clubs can be added. **Needs Paul's go-ahead.**
- [ ] Onboard the first clubs.

## Parked (post-launch)
- [ ] Club deletion: build and test on DEV first, then promote.
