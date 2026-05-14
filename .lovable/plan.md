
## Goal

Reduce information overload in the Auto Substitution Plan "Forecast" tab. Replace the current always-on stack (fairness diagnostics + suggested fixes + impact preview + simulator + full player bars) with a guided, plain-English layout for junior coaches.

All work is UI-only inside `src/components/pitch/AutoSubPlanDialog.tsx`. No planner, override storage, or fairness-calculation logic changes.

## New Forecast tab layout (top → bottom)

1. **Plan status card** (NEW `PlanStatusCard`) — single calm card with:
   - Headline status: "Plan looks good" / "Plan needs review" / "Plan is uneven" / "Too many short shifts" (derived from existing `spreadMin`, `shortShifts`, `hasHalftimeClash`).
   - 3 chips: `Substitutions`, `Playing-time spread`, `Short shifts`.
   - No technical jargon, no targets/highest/lowest grid.

2. **Recommended fix card** (refactored `PlanFixSuggestions`) — one primary fix only:
   - Title (e.g. "Stop players coming off too quickly").
   - One-sentence trade-off.
   - One **primary button**: "Apply recommended fix".
   - Below: collapsible "Other fixes" link revealing the remaining suggestions as compact rows. Hidden by default. Applied fixes still show an "Applied" badge.
   - Priority order for picking the recommended fix:
     1. `hasHalftimeClash` → "Avoid subs near halftime"
     2. `shortShifts > 0` → "Stop players coming off too quickly"
     3. `bounceBacks > 0` → "Space out substitution moments"
     4. `spreadMin > 6` → "Make minutes fairer"
     5. `spreadMin > 3 && constrainedByMinShift` → "Allow shorter shifts"
     6. busy + fair spread → "Reduce stoppages"
   - If no fixes available → card hidden.

3. **Impact preview** (existing `PlanImpactPreview`) — only rendered after the user applies/selects a fix (gated by `appliedFixIds.size > 0`). Shows before/after style summary (Substitutions / Spread / Short shifts / Halftime clash). Already collapsible — keep that.

4. **Players needing attention** (NEW compact summary) — replaces the always-on full bar list:
   - Lists only outfielders flagged as: lowest minutes, highest minutes, has short shifts, or has bounce-backs. Max ~5 rows. Each row: number, name, predicted minutes, single reason badge.
   - Footer button: "Show all player minutes" → expands the existing full forecast list (current per-player progress bars, unchanged).

5. **Preview changes** (renamed `FairnessSimulatorPanel`) — moved to the bottom and demoted:
   - Header label changed from "Fairness simulator" to "Preview changes" (aka "Check plan again"), with subtle styling so it doesn't compete with the status card.
   - Behavior unchanged.

6. **Show expert settings** — already-renamed `AdvancedSettingsPanel`, untouched, stays at the very bottom (existing position).

## Mapping to existing code

- `PlanStatusCard`: NEW small component near `FairnessDiagnostics` (which we stop rendering in the Forecast tab — keep the function for now in case it's referenced elsewhere, but remove it from the JSX).
- `PlanFixSuggestions`: change to accept `fixes` + a derived `recommendedId`. Render the recommended fix prominently with a `Button` ("Apply recommended fix"); render the rest behind a "Other fixes" disclosure (`useState`).
- `PlayersNeedingAttention`: NEW component above the existing `forecasts.map(...)` loop. Wrap the existing per-player rows in a `useState`-gated `<Collapsible>`-style block, default closed, toggled by "Show all player minutes".
- `FairnessSimulatorPanel`: keep impl, just relabel header to "Preview changes" and tone down the empty-state CTA (smaller, secondary variant).
- Order in JSX (lines 3546-3702): `PlanStatusCard` → recommended fix block → impact preview (gated) → players-needing-attention → expandable full list → preview-changes panel.

## Out of scope

- No edits to planner, `usePitchSettings`, override persistence, simulator math, or per-player forecast calculation.
- No new dependencies.
- Tests: existing 258 should continue to pass; no new tests required.
