## Phase 3 — Unified window builder

### Goal

Replace the two separate window-time generators (Standard ~lines 540–710, Frequent ~1380–1410) with a single `buildSubWindows(settings, context)` function so all three modes (Basic, Frequent, Advanced) flow through identical timing logic, driven only by the `eff` settings already resolved at the top of `createSubPlan`.

After Phase 3, the only real difference between modes is the values of `eff.*`, not the algorithm.

### What changes

**1. New helper `buildSubWindows(...)` (in `src/components/pitch/planner/windows.ts`, re-exported from `AutoSubPlanDialog.tsx`).**

Inputs:
- `startAbs`, `endAbs`, `halfDurationSeconds`
- `targetIntervalSec`, `intervalFloorSec`
- `noSubBeforeSec`, `noSubAfterSec`
- `halftimeGuardSec`, `halftimeGuardActive`
- `forcedTimes: number[]` (e.g. GK-protected windows, halftime swap, fairness rescues)

Output: `number[]` of absolute window times, deduped, sorted, blackout-filtered, with forced times always preserved.

Logic (single source of truth):
1. Spread interval-driven candidates evenly between `startAbs + max(intervalFloor, 60)` and `endAbs - noSubAfter`, stepping by `targetInterval`.
2. Drop any candidate inside settling-in (`< noSubBefore`) or end-of-half (`> halfDur - noSubAfter`) blackouts.
3. Drop any candidate within `halftimeGuardSec` of HT when `halftimeGuardActive`.
4. Add `forcedTimes` (unchanged — they bypass blackouts on purpose, like today's GK windows).
5. Sort + dedupe within `intervalFloor / 2`.

**2. Effective settings table per mode.**

Map current behaviour into the same `eff` shape so calls into `buildSubWindows` differ only in numbers:

| Setting | Standard (mode 1) | Frequent (mode 2) | Advanced |
|---|---|---|---|
| `targetIntervalSec` | `eff.standardTargetInterval` (default 420) | `max(eff.frequentIntervalFloor, totalRemaining / (targetWindowsTotal+1))` (default ~180–240) | user value |
| `intervalFloorSec` | `eff.standardIntervalFloor` (default 240) | `eff.frequentIntervalFloor` (default 180) | user value |
| `noSubBeforeSec` | 5 min (existing) | 2 min | user value |
| `noSubAfterSec` | 2.5 min (existing) | 45 s | user value |
| `halftimeGuardSec` | `eff.halftimeGuardSeconds ?? intervalFloor` | same | user value |

`noSubBeforeSec` / `noSubAfterSec` become real fields on `AutoSubAdvancedOverrides` (they already exist as constants) so Advanced mode can tune them. Defaults preserve current Standard / Frequent behaviour exactly.

**3. Wire-in points.**

- Standard branch: replace the `for (let t = …)` window loop (~lines 641–710 incl. GK rescue insertions) with `buildSubWindows(...)` plus the existing forced-GK time list passed in via `forcedTimes`. Bench-everyone synthetic windows (~line 990) stay where they are — they're a post-hoc patch on selection, not initial timing.
- Frequent branch: replace `directEventTimes` construction (~lines 1389–1406) with the same call.

**4. Tests.**

Add `src/components/pitch/planner/windows.test.ts`:
- Settling-in / end-of-half blackouts respected.
- Halftime guard suppresses windows within `halftimeGuardSec` of HT only when active.
- Forced times always survive blackouts and dedupe.
- `intervalFloor > targetInterval` is clamped (interval can never go below floor).
- Snapshot the window list for 5v5 / 7v7 / 9v9 / 11v11 at 25/30/35/45-min halves under both Standard and Frequent — must match the windows produced by today's code (within ±5 s tolerance) so the existing 12 planner tests still pass.

### Out of scope (kept for later phases)

- Player selection inside each window (still uses today's queue + fairness logic — Phase 2 already touched this).
- Spread-driven extra-window injection (Phase 4).
- Diagnostic "why" string (Phase 5).
- Test matrix expansion (Phase 6).

### Risk & rollback

- `createSubPlan` signature unchanged; dialog/editor/simulator untouched.
- If snapshot tests for Standard/Frequent diverge by more than ±5 s, revert to the per-mode loops behind a `USE_UNIFIED_WINDOWS = true` flag and ship Standard-only first.
- All 12 existing planner tests + the fairness matrix from Phase 2 must stay green before merge.

### Deliverables

1. `src/components/pitch/planner/windows.ts` (new).
2. `src/components/pitch/planner/windows.test.ts` (new).
3. `AutoSubPlanDialog.tsx` — Standard window loop and Frequent `directEventTimes` block both replaced with `buildSubWindows` calls; two new optional fields on `AutoSubAdvancedOverrides` (`noSubBeforeSec`, `noSubAfterSec`).
4. No UI changes in this phase — Advanced sliders for the two new fields land in Phase 5 alongside the diagnostic string.
