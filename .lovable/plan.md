## Goal

Make the soccer Pitch Board timer impossible to drift, lose seconds, or "revert" on resume by moving the source of truth from `localStorage` (counter + last-update timestamp) to the `active_games` row (event timestamps the server stamps). The client becomes a pure renderer.

Scope: soccer only (`GameTimer.tsx`, `GameTimerWidget.tsx`, `useActiveGameSync.ts`, `useActiveGameSpectator` consumers). Basketball/netball stay as-is for now — same pattern can follow once this is proven.

## New timer contract

Replace `{ elapsedSeconds, lastUpdateTime, isRunning, currentHalf, minutesPerHalf }` with event-based fields on `active_games.timer_state`:

```text
half_started_at        timestamptz   -- set when Play pressed for current half
half_paused_at         timestamptz   -- set on Pause, cleared on Resume
accumulated_pause_ms   integer       -- total paused time WITHIN current half
current_half           int           -- 1 | 2
minutes_per_half       int
is_running             boolean       -- derived but cached for queries
is_game_finished       boolean
half_ended_at          timestamptz   -- set at halftime / full time
server_now             timestamptz   -- echoed back on every read
```

Elapsed is **always derived**, never stored:

```text
elapsed_ms = (paused ? half_paused_at : now()) 
             - half_started_at 
             - accumulated_pause_ms
```

## Phases

### Phase 1 — Server primitives (DB + edge function)

1. Migration: add columns above to `active_games.timer_state` (it's JSONB, no schema change strictly needed; add a CHECK + a generated SQL view `active_games_with_elapsed` that computes `elapsed_seconds` server-side using `now()`).
2. New edge function `pitch-timer-event` accepting one of: `start_half`, `pause`, `resume`, `end_half`, `start_half_2`, `end_game`, `adjust` (admin-only). Function:
   - Authenticates caller, checks team admin/subs-manager role.
   - Reads current row, applies the event using server `now()`, writes back atomically.
   - Returns the new authoritative row including computed `elapsed_seconds` and `server_now`.
3. New edge function `pitch-timer-read` (or extend existing spectator read) that returns the row plus server-computed elapsed and `server_now`.

### Phase 2 — Client refactor

1. `GameTimer.tsx` / `GameTimerWidget.tsx`:
   - Remove the `elapsedSeconds + lastUpdateTime` localStorage projection logic, drift reconciliation, `flushOnHide` rewrites — gone.
   - On Play/Pause/HalfTime/EndGame → call `pitch-timer-event`. Optimistic local update for instant UI, replaced by server response.
   - Local tick is purely visual: `setInterval(50ms)` recomputes `elapsed = now() - half_started_at - accumulated_pause_ms` from the in-memory row. No persistence.
   - On mount/visibilitychange/online → call `pitch-timer-read`, snap to server elapsed, compute `clockSkew = server_now - Date.now()` and apply to local ticks so devices with wrong clocks still render correctly.
2. localStorage keeps only a **cache** of the last server row (for instant first paint offline). Never the source of truth.
3. `useActiveGameSync.ts`: shrinks dramatically — no more projecting elapsed, no more 10s "tick" writes. Writes happen only on events.

### Phase 3 — Offline + resilience

1. If `pitch-timer-event` call fails (offline), queue it in a new `timerEventQueue` (IndexedDB), keep optimistic local state, flush on reconnect in order. Each queued event carries the **client-captured timestamp** so server can replay with the right `now()`.
2. Server `pitch-timer-event` accepts optional `occurred_at` (clamped to ≤ `now()` and ≥ last event time) so offline-then-flushed events land at the right moment.
3. Spectator view (`useActiveGameSpectator`) switches to reading computed elapsed + `server_now`; same skew logic, no drift.

### Phase 4 — Cleanup

1. Delete `flushOnHide` drift-projection code added previously.
2. Remove `MAX_HALFTIME_SYNC_MS` heuristic — server can compute "abandoned" from `half_ended_at` age directly.
3. Update `TimerAudit` telemetry to log server round-trips and skew instead of local drift math.
4. Add unit tests for the event reducer (pure function, easy to test) and an e2e for kill-app-during-half-1.

## Why this kills the bug class

- **Lock phone / close app / navigate away:** no client tick needed; on resume we just re-derive from `half_started_at`. Zero seconds lost by definition.
- **3:31 freeze + revert to 10-min halves:** can't happen — `minutes_per_half` is server-owned, and elapsed is `now() - anchor`, so a stale localStorage write can never roll the clock back.
- **Two coaches see different times:** both derive from the same row → identical to the millisecond (modulo network).
- **Clock skew on device:** corrected via `server_now` echo.

## Trade-offs

- Every Play/Pause needs a network round-trip (~100–300ms). Optimistic UI hides it; offline queue handles bad networks.
- One more edge function to maintain.
- Slight cost increase: writes on events instead of every 10s — net **fewer** writes for most games.

## Effort

- Phase 1: ~2h (migration + 2 edge functions + tests)
- Phase 2: ~3h (refactor + delete old drift code)
- Phase 3: ~2h (offline queue + spectator)
- Phase 4: ~1h (cleanup + telemetry)

Total ~1 day. Can ship phases 1+2 first as MVP and add offline queue after.

## Open questions

1. Should the existing `GameTimerWidget` on Home read live from the server every 30s, or piggyback on the existing `active_games` realtime channel you already have?
2. Do you want admin "Adjust clock by N seconds" preserved? (Easy — just an event type.)
3. Keep basketball/netball on the old model for now, or migrate together?
