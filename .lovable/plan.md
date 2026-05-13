# Fairness-first substitution planner — phased rewrite

The current planner is already partially fairness-aware but its logic is spread across ~700 lines of `createSubPlan` with mode-specific branches (Standard / Frequent / Light Frequent), bench-aware cadence shrinking, GK-protected runs, spread escalation, and anti-yo-yo guards. A safe rewrite needs to land in phases so each step is testable against the existing 12-scenario suite.

## Goal

A single planner core that:

1. Optimises **final outfield minutes fairness first**, smoothness second.
2. Uses Basic / Frequent / Advanced settings as **inputs to the same algorithm** — the only difference between modes is the values fed in, not the logic.
3. Produces deterministic plans for identical inputs.
4. Keeps GK halftime swap, mid-game starts, mini-league per-team plans, position swaps, and minimum-shift protection intact.

## Algorithm shape

```text
target = (outfieldSlots × matchSeconds) / outfieldSquadSize

windows = evenly spaced by targetIntervalSec, snapped to floor,
          excluding opening / closing / halftime guard zones,
          shrunk if rotation cycle won't fit

for each window:
  advance minutesPlayed for everyone currently on pitch
  pick batchSize subs:
    OFF = on-pitch player with HIGHEST projected minutes,
          who has been on ≥ minShift
    ON  = bench-eligible player with LOWEST projected minutes
    resolve position: direct match → swap chain → mismatch
  escalate batchSize when current spread > maxSpread
```

GK rotation runs as a separate fixed event at the start of H2 and is excluded from the outfield rotation pool except for the explicit "starting-GK plays outfield in H2" / "2H-GK plays outfield in H1" protected runs.

## Phase plan

### Phase 1 — Extract & test the current planner (no behaviour change)

- Move `createSubPlan` and its helpers into `src/components/pitch/planner/` (`createSubPlan.ts`, `selection.ts`, `windows.ts`, `gkRotation.ts`).
- Re-export from `AutoSubPlanDialog.tsx` so callers/tests don't move.
- Confirms baseline: 12/12 tests still green.

### Phase 2 — Add a fairness-first core (`fairnessCore.ts`)

- New `pickSubsForWindow(state, settings)` that returns the OFF/ON pairs for a given window using projected-minutes scoring.
- Wire it into the existing `createSubPlan` only for the per-window selection step. Keep the existing window construction, GK handling, and post-processing.
- Re-run the 12 tests + the fairness matrix; tighten `spread ≤ 0.55 × matchMin` once Frequent-mode 5-a-side improves.

### Phase 3 — Unified window builder

- Replace the three mode-specific window blocks with one builder driven by settings:
  - `targetIntervalSec` (mode-mapped)
  - `intervalFloorSec` (mode-mapped: standard floor for Basic, frequent floor for Frequent)
  - `noSubBeforeSec`, `noSubAfterSec`, `halftimeGuardSec`
- Apply bench-aware shrink to the cycle that needs to fit, capped at floor.
- Mode mapping table:
  ```text
  Basic:    target = standardTargetIntervalSec, floor = standardIntervalFloorSec, batch = 1–2
  Frequent: target = max(frequentIntervalFloorSec × 1.5, standardTargetIntervalSec / 2),
            floor  = frequentIntervalFloorSec, batch = 2
  ```

### Phase 4 — Spread-driven batch escalation

- Compute `currentSpread` after each window.
- If `currentSpread > maxSpreadSec` and remaining windows can't fix it, add either an extra sub at the current window (batch +1) or insert a rescue window halfway to the next planned window (respecting floor + HT guard).
- Ensures the diagnostic "Uneven plan" warning rarely fires for normal squads.

### Phase 5 — Diagnostic feedback loop

- After plan generation, surface the same projected min/max/spread back into the existing `FairnessDiagnostics` panel, plus a one-line "why" string from the planner explaining the binding constraint (e.g. "halftime guard prevented 1 sub", "minShift prevented 2 swaps").
- Wire planner-emitted warnings into the panel.

### Phase 6 — Test matrix expansion

- Extend the existing fairness matrix to the full grid the previous turn requested:
  - on-field: 4, 5, 6, 7, 8, 9, 10, 11
  - bench: +0, +1, +2, +3, +4, +5
  - half lengths: 10, 15, 20, 25, 30, 35, 45 minutes
  - modes: Basic, Frequent
  - GK swap: on / off
- For each: assert no zero-minute players, spread within achievable bound, minShift respected, no duplicate on-pitch entries, no events outside match time.

### Phase 7 — Settings consistency

- Verify Basic and Frequent flows pass the same effective settings into the planner so coach changes in Advanced behave identically regardless of mode.
- Add a small contract test: `createSubPlan(... mode 1, advancedOverrides X) === createSubPlan(... mode 1, undefined)` when `X` matches defaults.

## Out of scope for this rewrite

- Locked players / unavailable players (no schema for these today).
- Position-rule presets beyond the existing `assignedPositions` list.
- Court-board (basketball/netball) planner — separate code path.

## Risk & rollout

- Each phase keeps `createSubPlan`'s public signature intact, so the dialog, the editor, the simulator, and the existing tests stay valid.
- After Phase 2 we can ship behind a feature check (`localStorage` flag) for a few days of real-coach validation before deleting the old per-window selection code in Phase 4.
- Estimated work: 2–3 focused sessions per phase. Phase 6 alone adds ~200 test cases that need an order of magnitude more compute per CI run; we'll need to mark the full grid as a separate `vitest` project so it doesn't slow normal runs.

## Asking before I start

This is a multi-session refactor. Two questions:

1. Are you OK with shipping Phase 1 + Phase 2 first (extraction + fairness-first per-window selection), behind no flag, validated by the existing tests? That's the smallest change that already produces "fairness-first" behaviour.
2. Do you want the full Phase 6 test matrix (~200 cases) added as a separate slow test project, or keep the current 12-case sweep and rely on real-game feedback?
