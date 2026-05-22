# Audit #4 + #6 — Scope & Fix

## TL;DR
- **#4 is a localized planner bug** with a clean, well-bounded fix (~15 LOC in `pitchStateUtils.ts`) and an existing skipped test ready to flip on. **Fix in this PR.**
- **#6 is a planner architecture issue** (unified-window builder rewrite, ~300+ LOC across `AutoSubPlanDialog.tsx`'s halftime GK swap path) that the matrix test already tolerates as ≤1 yo-yo. **Defer with a documented scope note** — not safe to touch in the same PR as #4.

---

## #4 — Recalc 30s short-circuit

### Root cause
`recalculateRemainingPlan` in `src/components/pitch/pitchStateUtils.ts` uses a static `minutesPlayed` snapshot for each candidate. Across the `for (const { time, half } of subTimes)` loop (lines 308–402), it never advances simulated minutes. So at line 345:

```ts
if ((mostPlayed.time - leastPlayed.time) < 30) break;
```

…a recalc triggered mid-half against a roster with near-equal minutes returns `[]`, even though many sub windows + bench depth remain — because by window N, the on-pitch leader will have accumulated `(N * intervalSec)` more seconds and would clear the 30s threshold.

The inner `continue` at line 358 and fallback at line 374 have the same blind spot.

### Fix
Simulate forward inside the window loop. Maintain a local `simulatedMinutes: Map<string, number>` initialized from `getPlayer(id)?.minutesPlayed`, and:

1. Between windows, add `(currentWindowAbsTime - lastWindowAbsTime)` to every currently-on-pitch player's simulated total.
2. Read sort keys from `simulatedMinutes` instead of `getPlayer().minutesPlayed`.
3. Keep the 30s threshold semantics unchanged — only the inputs change.

### Test
Flip `describe.skip` → `describe` in `pitchOrchestration.sim.test.ts:535` and replace the placeholder with a concrete case:
- 7-a-side, 5 bench, 25-min halves
- Inject equalized `minutesPlayed` at 14:00 of H1 with `subsAtOnce=1, intervalMinutes=5`
- Assert: returned plan is non-empty and chronologically valid.

Run the matrix as a regression check (`bun run test:matrix`) — no behavior change expected for fresh-game starts because `simulatedMinutes` equals `minutesPlayed` at window 0.

### Risk
Low. The change is additive (simulate forward), preserves all thresholds, and is unreachable from the createSubPlan path (different function). Only `recalculateRemainingPlan` callers are affected — primarily PitchBoard recalc on manual sub / pitch event.

---

## #6 — Halftime GK-swap yo-yo

### Root cause
In `AutoSubPlanDialog.tsx`'s halftime GK injection path (lines ~703–824), the H1 bench queue gets built as `[outfieldOnBench[0], ...h1Regulars, halftimeGkIn]`. When the bench size is tight (5-a-side, single bench, or 7-a-side with a small bench), the same halftime window ends up issuing both an `in` and an `out` for the new-GK's bench peer, producing one same-window yo-yo. The matrix test tolerates this (≤1) by design — see lines 148–175 of `AutoSubPlanDialog.matrix.test.ts`.

### Why defer
A clean fix requires what the code comments call the **unified-window builder rewrite** (referenced in matrix test line 140–141 and the Phase 3 design notes). Sketch:

1. Replace the dual H1 queue + halftime-injection path with a single window-list builder that knows about GK protection windows up front.
2. Collapse same-window `(in, out)` pairs at build time, never at validate time.
3. Re-derive the GK-protected outfield run as a constraint on the unified list, not a post-hoc patch.

That touches the planner's hottest path. Doing it alongside #4 invalidates the matrix baseline and risks regressing the 240-case sweep. It belongs in its own PR with its own matrix run.

### Action now
- Leave the ≤1 yo-yo tolerance in place.
- Convert the matrix test comment (lines 136–141) into a `// TODO(audit#6):` marker referencing the unified-window builder so the next person picking this up has the breadcrumb.

---

## Files touched in this PR
- `src/components/pitch/pitchStateUtils.ts` — simulate-forward in `recalculateRemainingPlan` (~15 LOC).
- `src/components/pitch/pitchOrchestration.sim.test.ts` — un-skip Audit #4 test, add concrete assertion.
- `src/components/pitch/AutoSubPlanDialog.matrix.test.ts` — comment-only TODO marker for #6.

## Out of scope
- #6 unified-window builder rewrite (own PR, own matrix soak).
- #9 PitchBoard split (own project).

## Verification
1. `bunx vitest run src/components/pitch/pitchOrchestration.sim.test.ts` — new test passes, existing pass.
2. `bun run test:matrix` — 240 cases stay green (yo-yo count unchanged at ≤1).
3. Manual PitchBoard smoke: mid-half manual sub on a balanced roster now produces a non-empty remaining plan.
