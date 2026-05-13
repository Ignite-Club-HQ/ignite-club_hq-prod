## Phase 4 — Spread-driven extra-window injection (DONE)

After the iterative fairness rebalance loop in `createSubPlan`, a new pass
attempts to INSERT brand-new sub events into existing schedule gaps when the
residual playing-time spread still exceeds the user's `maxSpreadMinutes` cap
(× 1.5 safety multiplier).

### Behaviour

- Triggers only when `currentSpread > max(FAIRNESS_TOLERANCE × 4, maxSpreadMinutes × 60 × 1.5)`.
- Up to 4 insertions per plan.
- Picks the most-overplayed and most-underplayed fairness target each pass.
- Walks every intra-half gap ≥ `2 × 90 s + 30 s`, requires the over player to
  be on pitch and the under player to be off pitch in that gap.
- Tries direct position match first, then a 3rd-player position swap.
- Each candidate is committed only if:
  - the simulated plan is still valid, AND
  - no individual fairness target loses more than 60 s, AND
  - resulting spread fits inside `maxSpreadMinutes × 60`, AND
  - resulting spread is strictly better than the current best.

### Known limitation (carry-over to Phase 5+)

Some U8/structural cases (e.g. half-game GKs colliding with bench players
who can only play one position) still resist injection because the only
viable insertion would invalidate a downstream sub (player is already on
pitch when the existing sub tries to bring them on). The injection
correctly rejects those candidates rather than producing an invalid plan.
A future phase should handle conflicting downstream subs by either
removing or rewriting them at the same time.

### Files changed

- `src/components/pitch/AutoSubPlanDialog.tsx` — new injection block before
  final `sortPlan()`.

No UI changes. No regressions to existing planner tests or the fairness
matrix. The pre-existing U8 standard-mode test failure noted in Phase 2
remains unchanged.
