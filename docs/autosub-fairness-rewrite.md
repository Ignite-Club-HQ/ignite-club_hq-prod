# AutoSub Fairness Rewrite — Follow-up Plan

## Status

`src/components/pitch/autoSubFairness.acceptance.test.ts` runs a curated 96-case grid and treats the user-configured `maxSpreadMinutes` cap as a **hard** planning constraint. Sim sanity (starvation, negative/over-match minutes) passes across the entire grid.

**Current baseline: 92 / 96 cases exceed the 5-minute cap; worst case +62.5min over.**

The suite reports breaches as a sorted summary (largest first) in `afterAll`, so the exact ranking is visible in test output. It does not fail the wider PR baseline so unrelated changes remain unblocked.

## What has been tried

1. **Lexicographic selector for the equal-time post-pass** (already merged) — prefer whichever plan meets the user cap; break ties by strictly smaller spread; equal-time wins on ties. Correct but not sufficient.
2. **minShift sweep** (already merged) — invoke `buildEqualTimePlan` with candidates `[60, 90, 120, eff.minShiftSeconds]`, pick the tightest-spread variant that sims valid. Helps middle-tier cases; **does not** move the hardest cases because the dominant spread driver is the fixed GK, not sub cadence.

## Why the hardest cases still breach

The largest breaches share a pattern: `gkSwap = false` on longer halves (30–45 min). With no halftime GK swap the starting GK plays the full match, and the harness (rightly) counts that as playing time. Equal-time cannot rebalance across the GK role while the GK is locked. Spread is bounded below by `halfDurationSec * 2 - target_outfield_minutes`, which is structurally >> 5 min for 20+ min halves.

## Recommended follow-up sequencing

1. **Freeze `autoSubFairness.acceptance.test.ts` as the acceptance gate**. Any planner tuning PR must not regress the passing count or the worst-breach magnitude reported in the summary.
2. **Extend `buildEqualTimePlan` to model GK time as part of the fairness target when `gkSwap` is false** — either by absorbing the GK's 90 min into their personal target and rebalancing outfield distribution around it, or by exposing a "GK contribution weight" the caller can pass through.
3. **Add an automatic GK-rotation suggestion** for cases where `spread > cap AND gkSwap == false` — surface a UI hint that enabling halftime GK swap would restore fairness. This converts an unsolvable planner constraint into a user decision.
4. **Adopt the spread cap as a lexicographic first-order key inside `createSubPlan`'s many local selection passes** (currently many pick by "primary metric + spread tiebreak"). Bounded scope: one selection site at a time, each guarded by the acceptance harness.
5. **Introduce a spread-driven repair pass** after `ensureNoStarvedPlayers`: while `spread > cap` AND a legal same-window swap reduces spread without breaking position constraints, apply it. Bounded to N iterations.

## Tests that must stay green throughout

- `AutoSubPlanDialog.test.ts` (representative sweep)
- `AutoSubPlanDialog.matrix.test.ts` (240 cases, `bun run test:matrix`)
- `AutoSubPlanDialog.frequentSafeguard.test.ts`
- `autoSub/repairPlan.test.ts`, `autoSub/selectors.test.ts`, `autoSub/autoSubReducer.test.ts`
- `autoSubFairness.acceptance.test.ts` (this suite — passing count must monotonically improve, worst-breach must monotonically decrease)
