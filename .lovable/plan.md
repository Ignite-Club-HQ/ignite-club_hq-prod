# Auto-Sub Plan Refactor

## Why this area keeps breaking

The plan today is **one piece of state with ~10 collaborators** all mutating or reasoning about it:

- `useAutoSubs.ts` (887 lines) — owns `autoSubPlan`, `autoSubActive`, `autoSubPaused`, `pendingAutoSub`, `pendingBatchSubs`, `subDuePlayerIds`, `nextSubInfo`, `lockedPlayerIds`, plus 9 handlers (`Start/Cancel/TogglePause/SkipNext/ExecuteNow/Regenerate/ConfirmAutoSub/SkipAutoSub/checkForDueSubs/checkHalftimeSubs`). Mixes UI confirm flow, scheduling clock, and plan mutation in one bag.
- `usePitchBoardPlanRepair.ts` — owns "repair on pitch-composition change" + "orphan cancel" + `recalcPlanForInjury`. Calls back into `useAutoSubs` via `setAutoSubPlan` and `regeneratePlanRef`.
- `pitchStateUtils.ts` — `recalculateRemainingPlanTeamAware`, `validateAndFixRemainingPlan` (pure-ish, but used in multiple call sites with subtly different inputs).
- `planner/equalTime.ts` + `planner/windows.ts` — actual generation algorithms.
- `PitchBoard.tsx` — wires `handleFormationChange`, swap handlers, injury handlers, persistence, `regeneratePlanRef.current?.()` calls in 4+ places.
- `AutoSubManager.tsx` / `AutoSubPlanDialog.tsx` / `GlobalSubMonitor.tsx` — UI consumers, each with their own derived "next sub" / "due" computations.

Three structural problems cause most regressions:

1. **No single source of truth for "what is the plan right now?"** Repair effects, regenerate, injury recalc, skip, execute and the dialog's "Save" all write `setAutoSubPlan` with their own derivations. Any one of them can stomp the others (the manual-sub preservation incident is exactly this).
2. **Implicit invariants**, never asserted. Things like "remaining ⊆ benchIds × pitchIds", "executed entries are append-only", "skip cooldown ≥ 3s", "GK never swapped except at HT" live in comments and ad-hoc `if`s. There is no choke point that validates a candidate plan before it becomes state.
3. **Side effects and pure logic are entangled.** `handleConfirmAutoSub` mutates the plan, fires toasts, schedules timeouts, advances `pendingBatchSubs`, and pokes `regeneratePlanRef` — making it almost impossible to unit-test or step through.

## Goal

Turn auto-subs into a small, explicit state machine with one reducer, pure planner helpers, and thin React adapters. Result: every plan change goes through one typed code path with assertable invariants, every UI surface reads from one selector, and bugs become reproducible in node.

## Plan

### 1. Define a typed event surface (`planEvents.ts`)

A discriminated union covering every way the plan can change:

```ts
type PlanEvent =
  | { type: "START";    plan: SubstitutionEvent[] }
  | { type: "CANCEL" }
  | { type: "PAUSE_TOGGLE" }
  | { type: "EXECUTE";  subKey: string }      // single sub
  | { type: "CONFIRM_BATCH"; subKeys: string[] }
  | { type: "SKIP";     subKey: string }
  | { type: "REPLACE_REMAINING"; remaining: SubstitutionEvent[]; reason: "regenerate" | "repair" | "injury" | "edit-dialog" }
  | { type: "LOCK_TOGGLE"; playerId: string }
  | { type: "TICK"; elapsed: number; half: 1|2 };  // for due-detection
```

`subKey = ${half}-${time}-${playerOut.id}-${playerIn.id}` (already used informally in repair).

### 2. One pure reducer (`autoSubReducer.ts`)

```ts
function autoSubReducer(state: AutoSubState, ev: PlanEvent, ctx: ReducerContext): AutoSubState
```

- `AutoSubState` = `{ plan, active, paused, lockedIds, pendingConfirm, pendingBatch, lastSkipAt }`.
- `ReducerContext` = `{ players, teamSize, minutesPerHalf, rotateGkAtHalftime, now }` — passed per dispatch; never stored.
- Reducer is pure: no toasts, no timers, no React state. Every mutation goes through here.
- Returns either the new state or a typed `PlanError` (`"orphan-player"`, `"locked-player"`, `"invalid-position"`, `"cooldown"`) so callers can surface UI messages without the reducer importing `toast`.

### 3. Extract invariants into one validator (`assertValidPlan.ts`)

Called by the reducer before any state transition that produces a new plan. Checks:

- Every `playerOut` ∈ on-pitch in current `players`.
- Every `playerIn` ∈ on-bench (or already executed earlier in same group).
- No duplicate `subKey`.
- `executed` entries never change.
- Skip cooldown respected.
- Locked players are not subbed off in remaining entries.

In dev it throws; in prod it returns a structured error and the reducer rejects the transition (existing state preserved).

### 4. Collapse repair paths

Today the plan is "repaired" in three places (`usePitchBoardPlanRepair` signature effect, the orphan effect, `recalcPlanForInjury`). All three become **one** function:

```ts
repairPlan(state, players, ctx): { plan, action: "kept" | "repaired" | "regenerated" | "cancelled" }
```

The hook just calls it and dispatches `REPLACE_REMAINING` or `CANCEL` accordingly. Same logic exercised by three triggers, no divergent branches.

### 5. Move clock-driven logic (`useAutoSubScheduler.ts`)

Today `checkForDueSubs`, `checkHalftimeSubs`, and `updateNextSubInfo` live inside `useAutoSubs`. Lift them into a tiny hook that:

- Takes `(plan, active, paused, gameTimerRef)`.
- Emits `TICK` events to the reducer.
- Computes `nextSubInfo` as a memoised selector (not state). One fewer setter to keep in sync.

### 6. Thin React adapter (`useAutoSubs.ts` becomes ~150 lines)

The new `useAutoSubs` just:
- Holds `useReducer(autoSubReducer, initial)`.
- Wires the scheduler hook.
- Returns stable `dispatch`-bound handlers (`startPlan`, `cancelPlan`, `skipNext`, `executeNow`, `togglePause`, `confirmCurrent`, `regenerate`, `toggleLock`).
- Surfaces toasts in one place (`useEffect` watching the reducer's `lastError`).

`PitchBoard.tsx` and `usePitchBoardPlanRepair.ts` lose all direct `setAutoSubPlan` calls — they dispatch events instead.

### 7. Unit tests against the reducer (fast feedback loop)

The reducer is pure and small. We add a `autoSubReducer.test.ts` that covers the historic bugs as named scenarios:

- "manual sub preservation: REPLACE_REMAINING with reason=repair never wipes user-edited entries"
- "injury during 2H regenerates only future window"
- "skip within 3s of last skip is rejected with `cooldown` error"
- "orphan player triggers CANCEL"
- "lock prevents that player appearing in `playerOut`"
- "HT rotation only fires when `rotateGkAtHalftime`"

Each is ~10 lines because there are no React, no timers, no toasts.

### 8. Selector layer for UI consumers

Add `selectors.ts`:

- `selectNextSub(state, half, elapsed, minutesPerHalf)`
- `selectRemainingForHalf(state, half)`
- `selectIsPlayerLocked(state, id)`
- `selectExecutedCount(state)`

`AutoSubManager`, `AutoSubPlanDialog`, `GlobalSubMonitor` switch from doing their own `.filter()`s on `autoSubPlan` to calling these. Stops the "different surface, slightly different definition of 'next'" class of bug.

### 9. Logging discipline

Every reducer transition logs `[AutoSub] EVENT_TYPE → result` with the diff size. One namespace, one place. When a user reports "subs misbehaved", the log is a linear story.

## Technical details

**Files touched**

- New: `src/components/pitch/autoSub/planEvents.ts`, `autoSubReducer.ts`, `assertValidPlan.ts`, `repairPlan.ts`, `selectors.ts`, `autoSubReducer.test.ts`, `useAutoSubScheduler.ts`.
- Rewritten thin: `src/hooks/useAutoSubs.ts` (887 → ~150 lines).
- Simplified: `src/components/pitch/hooks/usePitchBoardPlanRepair.ts` (dispatches instead of mutating).
- Touched (dispatch sites): `PitchBoard.tsx`, `AutoSubManager.tsx`, `AutoSubPlanDialog.tsx`, `GlobalSubMonitor.tsx`.
- Untouched: `planner/equalTime.ts`, `planner/windows.ts`, `pitchStateUtils.ts` calculation helpers — these are already pure; we just call them from the reducer/repair.

**Behavioural compatibility**

No user-visible change. Persistence shape (`savedState.autoSubPlan`, `autoSubActive`, `autoSubPaused`) stays identical so resume from disk keeps working.

**Order of operations (safe to ship incrementally)**

```text
Step A  Add planEvents.ts + autoSubReducer.ts + assertValidPlan.ts
        Add tests. No wiring yet. Existing app unaffected.
Step B  Switch useAutoSubs internals to useReducer, keep external API identical.
        All consumers continue to work. Run sim + existing tests.
Step C  Collapse repair paths into repairPlan(); update
        usePitchBoardPlanRepair to dispatch REPLACE_REMAINING / CANCEL.
Step D  Move scheduler into useAutoSubScheduler.
Step E  Introduce selectors; migrate AutoSubManager / Dialog / GlobalSubMonitor
        one at a time.
Step F  Tighten remaining `any` fields in PitchBoardLayoutContext for the
        auto-sub group (now they all have real types from the reducer).
```

Each step is independently revertable and runs the full test suite green before the next starts.

## Expected outcome

- One file (`autoSubReducer.ts`) is the only thing that can change `plan`. Bugs become "show me the event log" instead of "trace setState across 6 files".
- Historic incident classes (manual-sub-wipe, orphan cancel, injury recalc) have named regression tests.
- `useAutoSubs.ts` drops from 887 → ~150 lines; `PitchBoard.tsx` loses another ~80 lines of plan-mutation wiring.
- Debug story: a single `[AutoSub]` log namespace tells the whole story of what happened to the plan during a match.
