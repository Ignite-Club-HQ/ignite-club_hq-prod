## Phase 5 — Spread-aware swap selection (DONE)

`applyFairRotationAt` now uses the fairness gradient as the PRIMARY sort key
on both the bench and pitch queues, with FIFO acting only as a tiebreaker
inside a small deadband. Previously shortfall ordering was gated behind a
`capBreached` check, so until the cap was nearly breached the planner was
making FIFO swaps that ignored projected end-of-game minutes.

### Behaviour

- Bench queue (incoming player): largest shortfall first; FIFO
  (longest-waiting) only when |Δ shortfall| ≤ deadband.
- Pitch queue (outgoing player): smallest shortfall first (most over their
  fair share); FIFO (longest currently-on) only inside the deadband.
- Deadband = 30 s normally, 15 s when `capBreached` (preserves the previous
  more aggressive behaviour once the cap is in jeopardy).
- GK protection (Frequent mode) untouched — protected players still ride
  the gkCeilingTotal logic.

### Files changed

- `src/components/pitch/AutoSubPlanDialog.tsx` — both `.sort()` blocks
  inside `applyFairRotationAt`.

All 258 tests pass. No UI changes.
