## Goal
Collapse the 7 role/permission queries on `MessagesPage` into a single `get_messages_page_bootstrap` RPC, behind a runtime flag, with zero changes to existing behaviour until the flag is on.

## Phase 1 — Ship (this loop)

### 1. Database (additive only)
New `SECURITY DEFINER STABLE` function `public.get_messages_page_bootstrap(_user_id uuid)` returning a single JSON row:
```
{
  is_app_admin: bool,
  is_committee_member: bool,
  admin_club_ids: uuid[],
  admin_team_ids: uuid[],
  all_roles: [{ role, club_id, team_id }],
  member_club_ids: uuid[],
  member_team_ids: uuid[],
  pro_club_ids: uuid[],      -- clubs with active Pro
  pro_team_ids: uuid[],      -- teams with active Pro
  has_any_pro: bool
}
```
- Reads only: `user_roles`, `teams`, `club_subscriptions`, `team_subscriptions`.
- Does **not** touch `children`, `child_guardians`, `child_mini_league_assignments` (userLeagueIds keeps its own path — different RLS surface, defer to Phase 2).
- `GRANT EXECUTE ... TO authenticated`.

### 2. Frontend
- New hook `src/hooks/useMessagesPageBootstrap.ts` — one `useQuery` calling the RPC, `staleTime: 5min`.
- `MessagesPage` reads a runtime flag: `localStorage.getItem("msg_bootstrap_v1") === "1"` (default OFF).
- When **flag OFF**: zero behaviour change. Existing 7 queries run as today.
- When **flag ON**: the bootstrap query runs, and on success calls `queryClient.setQueryData(...)` for the 7 keys *before* the existing queries' `queryFn` resolves. Existing useQuery blocks stay in place but become instant cache hits and their `queryFn` is skipped for `staleTime` window.
- Add a one-line dev console helper: `window.__enableMsgBootstrap = () => localStorage.setItem("msg_bootstrap_v1","1")`.

### 3. Verification
- Flip the flag on your account only, reload `/messages`.
- Confirm in Network tab: 1 RPC call instead of 6–7 separate `user_roles`/subs queries.
- Confirm UI renders identically (admin badges, pro gates, group filters).
- If anything looks off → `localStorage.removeItem("msg_bootstrap_v1")` → instant rollback, no redeploy.

## Phase 2 — Cutover (next loop, once verified)
- Remove the flag, replace the 7 `useQuery` blocks with `useMemo`-derived values from the bootstrap.
- Add `userLeagueIds` to the bootstrap (separate migration since it touches more tables).
- Drop the unused individual queries.

## Phase 3 — Cleanup (later)
- Drop the now-unused branches of `hasAnyProAccess` chained queries.
- Optional: prefetch the bootstrap on app shell mount so `/messages` opens with cache warm.

## Out of scope
- No RLS changes.
- No changes to the inbox-message RPCs (`get_inbox_latest_*_messages`).
- No changes to `chat_groups` SELECT (separate, larger fix).
- No changes to caching/realtime logic.

## Rollback
| Scenario | Action |
|---|---|
| Issue with bootstrap data | `localStorage.removeItem("msg_bootstrap_v1")` — instant |
| Want to revert all code | Revert this chat message |
| Want to remove the RPC | One migration: `DROP FUNCTION public.get_messages_page_bootstrap` |

## Risk
- **DB**: zero (additive, read-only, no policy changes).
- **Frontend (flag off)**: zero (no code path touched).
- **Frontend (flag on)**: medium → mitigated by per-user opt-in and instant rollback.
