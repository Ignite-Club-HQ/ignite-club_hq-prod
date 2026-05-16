## Goal

Make the pitch board a **shared, team-wide** game session instead of a per-device session, with role-scoped permissions:

- **Team admins + Subs Managers (duty for the event)**: full read/write control of the same live game. Either can start it, run the timer, accept subs, change pitch state — and they all see the same state in real time.
- **Coaches, team_admins not assigned + everyone else with team visibility**: read-only spectator view of the same live game (currently only basketball/netball has Watch Live — extend to soccer).
- **Notifications** (pending sub, half time, full time, auto-sub fired): only delivered to team admins + the event's Subs Manager. No-one else gets pushes.

## Architecture changes

### 1. `active_games` becomes team-scoped, not user-scoped

Today the row is keyed by `(user_id, team_id)` and only the writer can read/update it. New model:

- One active row per `team_id` (the unique constraint `uniq_active_games_team_active` already enforces this).
- `user_id` becomes "last writer" metadata (kept for audit), not the access key.
- RLS:
  - **SELECT**: any user with team visibility (admin/coach/parent/player on that team).
  - **UPDATE/INSERT**: only `team_admin` for the team OR user assigned the `Subs Manager` duty on the linked event (timer state stores `linkedEventId` already).
  - **No DELETE** from clients.
- New helper function `public.can_control_pitch_board(team_id, event_id)` to centralise the admin-or-subs-manager check, used by RLS and the client.

### 2. Sync hook collaborates instead of owning

`useActiveGameSync` (and the basketball/netball equivalents where relevant):

- On mount, **subscribe** (Realtime) to the team's `active_games` row.
- If the row exists and the current user **cannot control**, run in **spectator mode**: ignore local state, render the server row.
- If the user **can control**:
  - Adopt the existing row's `id` instead of always inserting their own.
  - Last-writer-wins on each 10s tick (timer keeps ticking locally; server merges).
  - When two controllers are open at once, the latest `updated_at` wins — acceptable because subs managers coordinate verbally.

### 3. Watch Live extended to soccer

`WatchLiveTeamPage` currently filters to basketball/netball. Extend it to render a soccer read-only pitch when the team's `active_games.timer_state.sport === 'soccer'` (or absence of sport, which is current default). Re-use the existing `PitchBoard` in a `readOnly` mode (already partially supported for spectators).

### 4. Notification recipients tightened

`usePitchBoardNotifications`, server-side `pitch-board-cron`, and `useAutoSubNotify` all already include `team_admin + coach + Subs Manager`. Per the request, **drop `coach`** from these recipient lists so only admins + the active Subs Manager get notified. Other coaches can still open Watch Live to follow along, but won't be pinged.

### 5. Entry points

The "Open Pitch Board" / "Start Game" buttons on `EventDetailPage` and `NextUpCarousel` already use `useCanStartGame` (admin OR subs-manager). When a server-side `active_games` row already exists for the team, those entry points should:

- Route controllers (admin/subs-mgr) into the live board (joining the shared session).
- Route everyone else with team visibility into Watch Live.

## Files touched

- `supabase/migrations/<new>.sql` — new RLS on `active_games`, new `can_control_pitch_board` function.
- `src/hooks/useActiveGameSync.ts` — adopt-shared-row semantics, realtime subscribe, role-gated writes.
- `src/components/pitch/PitchBoard.tsx` — react to realtime row updates when current user is a non-controller (read-only render path).
- `src/pages/WatchLiveTeamPage.tsx` — handle soccer (currently basketball/netball only).
- `src/hooks/useCanStartGame.ts` — re-use the new `can_control_pitch_board` RPC.
- `src/hooks/useAutoSubNotify.ts` — drop generic `coach` role, keep `team_admin` + `Subs Manager` duty.
- `src/hooks/usePitchBoardNotifications.ts` + `supabase/functions/pitch-board-cron/*` — same recipient tightening.
- `src/pages/EventDetailPage.tsx` + `src/components/NextUpCarousel.tsx` — route non-controllers to Watch Live when a shared session is live.

## Risks / call-outs

- **Two controllers editing simultaneously** = last write wins. There's no operational-transform / merge. In practice subs managers don't edit the pitch at the same time, but flag it.
- **Mini-league `event-group-*` games** use a separate sync path (`useEventGroupSync`) and already share state — not in scope unless you want the same treatment.
- **Coaches losing push notifications** is a deliberate scope change per your message — confirm before I ship it.
- This is a meaningful refactor (touches ~8 files plus a migration). I'll do it in one migration + one code pass, then verify the build.

Confirm and I'll execute.