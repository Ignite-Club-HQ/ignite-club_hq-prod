

## Replace "Back to Match" with a settings dropdown in Training Mode

Currently the Training Mode header shows a "Back to Match" button. That phrasing implies match is the "real" mode and training is a detour — which isn't right, since both are first-class modes. We'll replace that single button with the **same gear-icon settings dropdown** used in Match Mode, containing the Mode switcher at the top so users can flip between Match and Training the same way in both views.

### What changes in the Training header

Replace the "Back to Match" button with a gear icon (⚙). Tapping it opens a dropdown:

```text
┌──────────────────────────────┐
│  MODE                        │
│  ⚔  Match Mode               │   ← tap to switch
│  📋 Training Mode      ✓     │   ← active (bold, check)
│  ──────────────────────────  │
│  ⚙  All Settings             │
└──────────────────────────────┘
```

Training Mode has no Setup Game / Auto Subs / Match Stats / Reset Game items — those are match-only — so the dropdown is intentionally minimal: just the Mode toggle and All Settings.

### Behaviour

- Tapping **Match Mode** calls `setMode("match")` (same call the Match dropdown's Training row uses) and closes the menu — this replaces "Back to Match" exactly.
- Tapping **Training Mode** while already in training: closes the menu (no-op).
- Tapping **All Settings** opens the existing `PitchSettingsDialog`, same as Match Mode.
- Live training state (current drill, frames, edit/preview state) is preserved across mode toggles — same as today.

### Consistency with Match Mode

This mirrors the dropdown we're adding to Match Mode in the previous plan, so both views share identical mode-switching UX. One mental model: gear icon → Mode section at top → switch.

### Files touched

- `src/components/pitch/training/TrainingBoard.tsx` (or wherever the Training header lives — the component rendering the "Back to Match" button) — remove the "Back to Match" button, add a `DropdownMenu` with gear trigger, Mode section (two rows), separator, and "All Settings" item. Wire `setMode("match")` to the Match Mode row and reuse the existing settings dialog open handler.

No new components, no DB changes, no migrations. Match-mode dropdown changes are covered by the previous plan.

