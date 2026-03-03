

## Plan: Add Auto Subs Quick Access to Bench Drawers

### What
Add an "Auto Subs" action button inside both the portrait and landscape bench drawers, giving users quick access to set up or manage auto substitutions without navigating through the settings menu.

### How

**File: `src/components/pitch/PitchBoard.tsx`**

Add a button row below the position filter chips in both bench drawers (portrait ~line 6056, landscape ~line 5164):

- **When no auto-sub plan is active**: Show a "Setup Auto Subs" button that calls `openAutoSubPlanDialog()` (opens the plan generator dialog)
- **When auto-sub plan is active**: Show a "Manage Subs" button (with pulse indicator) that calls `setAutoSubPanelOpen(true)` (opens the control panel)
- Both buttons close the bench drawer before opening their respective dialogs
- Hidden when `readOnly` or `disableAutoSubs` is true
- Uses existing `ArrowRightLeft` or similar icon for visual consistency

The button will sit between the position filter chips and the bench player list, styled as a full-width outline button with appropriate icons. When a plan is active, it shows the sub count (e.g., "Auto Subs (3/8)") matching the control panel badge style.

### Scope
- Single file edit: `src/components/pitch/PitchBoard.tsx`
- Two insertion points: landscape bench (~line 5164) and portrait bench (~line 6057)
- No new components or state needed — reuses existing handlers

