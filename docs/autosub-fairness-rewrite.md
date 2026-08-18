# AutoSub Fairness Rewrite — Follow-up Plan

## Status

`src/components/pitch/autoSubFairness.acceptance.test.ts` runs a curated 96-case grid and reports two spread metrics per case (see harness header). Sim sanity (starvation, negative/over-match minutes) passes across the entire grid.

**Current baseline (rotation-pool spread — cap-enforced, rerun 10 August 2026):**
- 9 / 96 cases exceed the 5-minute cap
- All 9 are Standard mode with halftime goalkeeper rotation enabled
- Worst case: +4 min over cap / 9-minute spread (7-a-side, +4 bench,
  30-minute halves, mode 1, gkSwap=true)

**Informational baseline (full-squad spread):**
- 48 cases balance within rotation pool (≤ cap) but breach the full-squad cap
  **only** because the locked GK is playing the entire match. These are the
  "enable halftime GK swap" UX nudge candidates.

Prior reports (92/96, +62.5min worst) conflated the locked-GK role with rotation-pool fairness. The equal-time planner explicitly excludes GK-only players from its rotation pool by design — those minutes are structurally fixed. Measuring them against the same cap was a harness bug, not a planner bug.

## What has been tried

1. **Lexicographic selector for the equal-time post-pass** (merged) — prefer whichever plan meets the user cap; break ties by strictly smaller spread; equal-time wins on ties.
2. **minShift sweep** (merged) — invoke `buildEqualTimePlan` with candidates `[60, 90, 120, eff.minShiftSeconds]`, pick the tightest-spread variant that sims valid.
3. **Split fairness metrics in the acceptance harness** (merged) — separate rotation-pool spread (cap-enforced) from full-squad spread (informational). Reveals actual planner-controllable residual is ~14 min worst case, not ~62 min.

## Remaining rotation-pool breaches

The worst residual cases (spread 15–19 min at a 5-min cap) share a pattern: mode 2 (balanced) on longer halves. The equal-time post-pass adopts a plan when it strictly beats the incumbent, but the incumbent's `MAX_REBALANCE_ITERATIONS` guard sometimes settles at a plateau the equal-time variant can also not escape given the min-shift constraint. Follow-ups:

1. **Adopt spread cap as a first-order key** in `createSubPlan`'s local selection passes — currently many pick by "primary metric + spread tiebreak"; flipping the priority for cases where `currentSpread > capSec` closes the gap without hurting mode 2's continuity when already inside the cap.
2. **Spread-driven repair pass** after `ensureNoStarvedPlayers`: while `rotationSpread > cap` AND a legal same-window swap reduces spread without breaking position constraints, apply it. Bounded to N iterations (already partially present as `MAX_REBALANCE_ITERATIONS`; needs to widen the swap search to include batched multi-window edits).
3. **UI nudge on the "enable GK swap" pattern** — when `gkSwap=false` and full-squad spread > cap but rotation spread ≤ cap, surface an inline hint in the fairness readout suggesting the coach enable halftime GK rotation.

## Tests that must stay green throughout

- `AutoSubPlanDialog.test.ts` (representative sweep)
- `AutoSubPlanDialog.matrix.test.ts` (240 cases, `bun run test:matrix`)
- `AutoSubPlanDialog.frequentSafeguard.test.ts`
- `autoSub/repairPlan.test.ts`, `autoSub/selectors.test.ts`, `autoSub/autoSubReducer.test.ts`
- `autoSubFairness.acceptance.test.ts` — rotation-pool breach count and worst-breach magnitude must both monotonically decrease.
