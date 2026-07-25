# AutoSub Fairness Rewrite — Follow-up Plan

## Status
`src/components/pitch/autoSubFairness.acceptance.test.ts` runs a curated 96-case grid and treats the user-configured `maxSpreadMinutes` cap as a **hard** planning constraint (previously a soft preference).

Baseline snapshot at time of writing: **68 / 96 cases exceed the 5-minute cap**, worst case ~28min over (5–11 a-side, various bench sizes and modes). Sim sanity (starvation, negative/over-match minutes) passes across the entire grid, so the plans are structurally valid — they're just not fairness-optimal.

The suite reports breaches as a soft summary in `afterAll` rather than failing, so it doesn't block the wider PR baseline (`809+ passing`) while the primary-path rewrite is scoped.

## Why not rewrite `createSubPlan` now
`createSubPlan` (approx. lines 610–3060 of `AutoSubPlanDialog.tsx`, ~2450 lines) is highly branchy: GK protection, halftime GK swap, unified-window builder, anti-yo-yo pass, equal-time post-pass, spread injection, ensureNoStarvedPlayers. Rewriting it without a targeted spec risks regressing the existing matrix/frequent-safeguard tests that gate every PR.

## Recommended follow-up sequencing
1. **Freeze the harness** as the acceptance gate. Any planner tuning PR must not regress the count of passing cases.
2. **Rewrite the equal-time post-pass into a primary path**, not a fallback. `buildEqualTimePlan` in `planner/equalTime.ts` already produces near-optimal spread on the eligible subset (fresh start, half 1, elapsed 0). Extending its eligibility (any elapsed time, either half start) and making it the default output — with the current heuristic planner as a fallback only when equal-time fails to sim — should collapse most breaches.
3. **Adopt the spread cap as a lexicographic first-order key** everywhere the planner selects between candidate mutations (currently many local passes score by "primary metric + spread tiebreak"). This was already applied to the equal-time swap in the current turn (see lines 3030–3050 of `AutoSubPlanDialog.tsx`).
4. **Introduce a spread-driven repair pass** after `ensureNoStarvedPlayers`: while spread > cap AND there is a legal same-window swap that reduces spread without breaking position constraints, apply it. Bounded to N iterations.
5. **Re-run the acceptance harness** after each step and record the passing count in the docstring.

## Tests to keep green throughout
- `AutoSubPlanDialog.test.ts` (representative sweep)
- `AutoSubPlanDialog.matrix.test.ts` (240 cases, `bun run test:matrix`)
- `AutoSubPlanDialog.frequentSafeguard.test.ts`
- `autoSub/repairPlan.test.ts`, `autoSub/selectors.test.ts`, `autoSub/autoSubReducer.test.ts`
- `autoSubFairness.acceptance.test.ts` (this suite — passing count must monotonically improve)
