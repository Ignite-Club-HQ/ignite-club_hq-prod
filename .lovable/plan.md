## Goal

Reframe the Auto Substitution tuning UI so a junior coach can read a plain-English diagnosis of their plan, tap a recommended fix, preview the impact, and only see raw sliders if they explicitly opt into expert mode.

All changes are UI-only inside `src/components/pitch/AutoSubPlanDialog.tsx`. No planner/algorithm changes.

## Current state (recap)

- `FairnessDiagnostics` (line ~2820) shows Target / Highest / Lowest / Spread + a static sentence and a generic "Try Frequent mode" hint. It is decoupled from any action.
- `AdvancedSettingsPanel` (line ~3516) is titled "Advanced substitution tuning" and exposes 6 raw sliders (How often to suggest subs, Max spread, Floor, Frequent floor, Min shift, Halftime guard).
- The Forecast tab renders: `FairnessDiagnostics` → `FairnessSimulatorPanel` → per-player rows. The Advanced panel sits below.

## New UX (Forecast tab order)

1. **Plan summary card** (existing FairnessDiagnostics, lightly trimmed) — Highest / Lowest / Spread + one-line diagnosis.
2. **Fix suggestions card** (NEW `PlanFixSuggestions`) — appears whenever the diagnosis tone is `info` or `warn`, OR whenever the simulator reports short shifts / bounce-backs / halftime clashes. Each fix is a tappable row:
   - Title in coach language ("Make minutes fairer", "Reduce stoppages", "Stop players coming off too quickly", "Space out substitution moments", "Avoid subs near halftime").
   - One-sentence trade-off ("gives the planner more chances to balance game time, but may create more substitution moments").
   - Tap → applies a concrete delta to `localOverrides` (e.g. `standardTargetIntervalSec -= 60`, clamped to slider min) and re-runs the plan.
   - Each fix is gated on the actual metric that triggered it — no fix shows if it would not address a detected issue (covers requirement #15).
3. **Impact preview** (NEW `PlanImpactPreview`) — appears after a fix is tapped (or when overrides differ from defaults). Shows:
   - Plain-English sentence: "This will prioritise fairer minutes, allow slightly more substitution moments, and protect players from short shifts."
   - Measurable expected outcomes pulled from the just-recomputed plan + simulator: expected substitutions, expected spread, whether short shifts / halftime clashes are detected.
4. **Fairness simulator** (existing) — unchanged, but its short-shift / bounce-back / halftime-clash counters feed the diagnosis + fix gating above.
5. **Per-player rows** — unchanged.
6. **Show expert controls** (renamed `AdvancedSettingsPanel`) — collapsed by default, label changed from "Advanced substitution tuning" to "Show expert controls". Inside, slider labels become outcome-based:
   - "How often to suggest subs" → "Fairer minutes vs fewer stoppages"
   - "Minimum gap between sub moments" → "Space out substitution moments"
   - "Minimum gap in Frequent mode" → same outcome label, Frequent-only note
   - "Minimum time on field" → "Allow short cameos vs protect player shifts"
   - "Avoid subs near halftime" → "Allow halftime subs vs keep halftime clean"
   - "Max playing-time spread" stays (it is already outcome-based).
   - The "Common problems" troubleshooting block is removed (replaced by Fix suggestions above).

## Diagnosis → fix mapping

| Detected condition | Suggested fix | Action on tap |
|---|---|---|
| `spread > 3` and bench is large in Standard mode | "Make minutes fairer" | switch `rotationSpeed` to Frequent OR lower `standardTargetIntervalSec` by 60 s |
| `spread > 3` and `constrainedByMinShift` | "Allow shorter shifts" | lower `minShiftSeconds` by 30 s |
| `spread > 6` general | "Make minutes fairer" | lower `standardTargetIntervalSec` by 60 s |
| Simulator reports short shifts > 0 | "Stop players coming off too quickly" | raise `minShiftSeconds` by 30 s |
| Simulator reports halftime clash | "Avoid subs near halftime" | raise `halftimeGuardSeconds` by 60 s |
| Simulator reports bounce-backs > 0 | "Space out substitution moments" | raise `standardIntervalFloorSec` by 30 s |
| Plan looks busy (many subs vs target) | "Reduce stoppages" | raise `standardTargetIntervalSec` by 60 s |

All deltas clamp to existing slider min/max so they cannot push the planner out of its supported range.

## Terminology consistency

Mode labels remain "Standard" and "Frequent" (already used in code). Drop the stray "Basic" wording in the existing `AdvancedSettingsPanel` hint copy. Drop "Custom" entirely.

## Mobile / desktop

Fix suggestions render as a vertical list of tap-targets (`min-h-[44px]`, full-width on mobile, 2-col grid `sm:grid-cols-2` on desktop). Impact preview is a single card that wraps cleanly. No new dependencies.

## Implementation steps (single file)

1. Add a `usePlanFixSuggestions(forecasts, fairnessReport, mode, overrides, …)` hook that returns an array of `{ id, title, tradeoff, apply: (overrides) => overrides }`.
2. Add `PlanFixSuggestions` and `PlanImpactPreview` components above `FairnessSimulatorPanel`.
3. In `DialogInner`, wire them in between the existing diagnostics and simulator, passing `setLocalOverrides` / `setRotationSpeed` for `apply`.
4. Rename `AdvancedSettingsPanel` trigger to "Show expert controls", relabel sliders, drop "Common problems" block, drop "Basic" wording.
5. Keep `effectiveOverrides`, persistence, and planner inputs untouched.

## Out of scope

- No planner/algorithm changes.
- No changes to `usePitchSettings`, persistence shape, or `AutoSubAdvancedOverrides`.
- No new tests required (UI-only); existing 258 main + 240 matrix tests must still pass.
