
Two independent defects, both fixable in frontend/business logic. The spec explicitly asks me to explain root cause before implementing — plan first, code after your approval.

## Defect 1 — Timer resets to 0:00 after lock/resume

### Root cause

`GameTimer.applyServerSnapshot` (`src/components/pitch/GameTimer.tsx`) unconditionally overwrites local state with whatever `pitch-timer-read` returns. Two failure modes hit the same code path:

1. On lock/resume `reconcileAfterResume` calls `readServerTimer`, gets a **stale** response (edge-function cold-start delay, replica lag, or an out-of-order fetch that races a newer read), and applies it — snapping a live 16:00 clock back to 0:00.
2. Multiple listeners (`visibilitychange`, `pageshow`, `focus`, `resume`, Capacitor `appStateChange`) all fire in quick succession on Android resume and each kicks off its own async read. The last response to arrive wins even if it was the *first* one dispatched (races).

There is no comparison of the incoming server snapshot against either (a) the last accepted server snapshot's `last_event_at`, or (b) the currently displayed timer state.

### Fix (single centralised guard)

Introduce `shouldAcceptServerSnapshot(prev, incoming, local)` in `src/lib/serverTimer.ts`:

- Accept when there is no `prev` (first hydrate).
- Accept when `incoming.last_event_at > prev.last_event_at` (strictly newer authoritative event).
- Accept when `incoming.last_event_at === prev.last_event_at` AND `is_running`/`current_half`/`is_game_finished` are unchanged (idempotent re-read, safe to reapply).
- Accept explicit newer resets: a snapshot where `is_running===false`, `half_started_at===null`, `current_half===1` AND `last_event_at > prev.last_event_at` is a legitimate manual reset.
- **Reject** otherwise — in particular, a snapshot older-or-equal to `prev.last_event_at` that would move the derived elapsed backwards while the local timer is running or advanced.

Wire it into `GameTimer.tsx`:

- Track `lastAcceptedEventAt` and the team-id under which it was captured in refs.
- Wrap `applyServerSnapshot` with the guard; drop rejected snapshots with an audit log.
- Capture the active team-id at the start of every async read; discard the response if `teamId` changed before it resolved (prevents cross-team leakage).
- Preserve existing behaviour: manual `resetTimer`, `set_minutes`, half transitions, and offline localStorage fallback all continue to work — they either mutate through `sendTimerEvent` (returns a strictly newer `last_event_at`) or the localStorage path (unchanged).

### New test — `src/components/pitch/GameTimer.lifecycle.test.tsx`

Reproduces the failure by hydrating at 16:00, dispatching a resume that returns a stale zero snapshot, and asserting the displayed elapsed time does not move backwards. Also asserts:
- an out-of-order response with a stale `last_event_at` is dropped
- a legitimate newer reset IS applied
- team-id change during an in-flight read discards the response

## Defect 2 — Autosub plans exceed the requested maximum spread

### Root cause

`AutoSubPlanDialog.createSubPlan` (~2400 LOC) produces the primary plan; only when a narrow set of guards pass does it hand off to the fairness-optimal `buildEqualTimePlan` post-pass. In the failing scenarios (11-a-side/3-bench mode-1, 9-a-side/4-bench mode-1, etc.) either the eligibility gate rejects the equal-time result, or the comparison scorer picks the worse primary plan because it compares on a different metric (shift smoothness / continuity) than the user-visible spread.

The requested `maxSpreadMinutes` cap is used as a soft preference during scoring, not a hard constraint: when the equal-time planner returns a feasible plan that meets the cap, the production selector still picks the primary plan if it wins on secondary objectives.

### Fix (planner selection, no schema changes)

1. Always run `buildEqualTimePlan` alongside `createSubPlan` for every eligible configuration (drop the current narrow eligibility gate — the equal-time planner is already deterministic and O(N²·slices), which is bounded for realistic squads).
2. Simulate both plans through the existing production simulator so their reported `projectedSec` uses identical eligibility/GK/minutesPlayed inputs.
3. Choose lexicographically: (a) valid/playable → (b) meets `maxSpreadMinutes` cap → (c) minimises spread → (d) minimises max deviation → (e) minimises shift churn.
4. Expose a diagnostic on the returned plan when the cap is mathematically infeasible (e.g. cap smaller than `chunkSec × ceil-floor gap`), so the UI can surface "closest achievable" instead of silently ignoring the cap.
5. Include starting deficit (`minutesPlayed`) and full-game GKs in the fairness objective — already handled by `equalTime.ts`, just needs to be honoured by the selector.

### New tests

- `src/components/pitch/planner/autosubFairness.acceptance.test.ts` — every scenario from the spec (5-a-side/3-bench through 11-a-side/5-bench, modes 1 and 2, 20–45 minute halves) asserted against its stated cap.
- `src/components/pitch/planner/equalTime.constraints.pending.test.ts` — monotonicity: a tighter feasible cap never produces a worse plan than a looser cap.
- `src/components/pitch/timerUtils.test.ts` — direct coverage for the new `shouldAcceptServerSnapshot` guard.

## Files touched

Production:
- `src/lib/serverTimer.ts` — add `shouldAcceptServerSnapshot`.
- `src/components/pitch/GameTimer.tsx` — wire guard + capture team-id per read.
- `src/components/pitch/AutoSubPlanDialog.tsx` — planner selector rewrite (local to the selection block, ~150 LOC).
- `src/components/pitch/planner/equalTime.ts` — expose infeasibility diagnostic.

Tests (new, no existing tests weakened):
- `src/components/pitch/GameTimer.lifecycle.test.tsx`
- `src/components/pitch/timerUtils.test.ts`
- `src/components/pitch/planner/autosubFairness.acceptance.test.ts`
- `src/components/pitch/planner/equalTime.constraints.pending.test.ts`

## Out of scope (per your safety rules)

- No DB migrations. No changes to `pitch-timer-event` / `pitch-timer-read` edge functions. No auth / RLS changes. No archived sport changes. No changes to unrelated tests.

## Validation

`npx vitest run` on all seven files listed in your spec, then the full frontend baseline (currently 824+ passing). Success = stale-resume test green, every fairness scenario meets its cap, all pre-existing timer/autosub tests still green.

Approve and I'll implement in this order: (1) timer guard + lifecycle test, (2) planner selector + acceptance test, (3) diagnostics + constraints test, (4) run full baseline and report the six items your spec requires before finishing.
