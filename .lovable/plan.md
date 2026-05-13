## Phase 6 — Slow fairness matrix sweep (DONE)

A 240-case regression sweep over the planner is now in
`src/components/pitch/AutoSubPlanDialog.matrix.test.ts` and runs as a
separate vitest project so PR CI stays fast.

### Grid

4 team sizes × 3 bench sizes × 5 half lengths × 2 modes × 2 GK-swap states
= 240 cases. For each case we assert:

- No negative or over-match minutes per player.
- No starved players (≥ 30% of fair-share target — tight floor that still
  catches truly broken plans without flagging structurally constrained
  cases like 5-a-side + 1 bench + halftime GK swap).
- Spread ≤ 75% of match length (calibrated to current planner output;
  tightening requires the unified-window builder originally sketched in
  Phase 3 notes).
- At most one same-window in-then-out yo-yo across the full plan.

### How to run

`bun run test:matrix` (uses `vitest.matrix.config.ts`). The default
`bun run test:run` excludes `**/*.matrix.test.ts` so the regular suite
stays under 20 s.

### Files changed

- `src/components/pitch/AutoSubPlanDialog.matrix.test.ts` — new sweep.
- `vitest.matrix.config.ts` — separate slow project.
- `vitest.config.ts` — exclude matrix tests from default run.
- `package.json` — `test:matrix` script.

All 258 main tests + 240 matrix tests pass.

---

## Phase 5 — Spread-aware swap selection (DONE)

`applyFairRotationAt` now uses the fairness gradient as the PRIMARY sort
key on both the bench and pitch queues, with FIFO acting only as a
tiebreaker inside a small deadband.
