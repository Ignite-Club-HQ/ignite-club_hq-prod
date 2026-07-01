# Per-group-chat row badges via `chat_group_unread`

## Goal
Move per-row unread badges for **group chats** (both "League" and "Group" rows in MessagesPage) off the `get_unread_message_counts` RPC path and onto the denormalised `chat_group_unread` cache table. Other scopes (teams, clubs, DMs, broadcast) keep using the RPC unchanged. This is the payoff for the cache table we already shipped.

## Why this is worth doing
- Removes the group-messages JOIN + aggregate from the hottest inbox RPC.
- Per-row badges update instantly via realtime on `chat_group_unread` (one row per user/group) instead of waiting for a full RPC refetch on every notification.
- Cheap fallback: if the hook errors, rows fall back to the existing `unreadCounts.groups[id]` value, so nothing breaks.

## Scope (what changes)

### 1. New hook: `useGroupChatUnreadCache`
Reads the current user's rows from `chat_group_unread` and returns `Record<groupId, unread_count>`.
- Single query keyed by `["chat-group-unread-cache", userId]`.
- Realtime subscription on `chat_group_unread` filtered by `user_id=eq.${userId}` — INSERT/UPDATE/DELETE all patch the local cache (no refetch needed since payload contains `group_id` + `unread_count`).
- Same `staleTime`/jitter defaults as `useUnreadMessageCounts`.
- Cleanup removes the channel on unmount (per project realtime rule).

### 2. MessagesPage wiring
- Call `useGroupChatUnreadCache(user?.id)` alongside the existing `useUnreadMessageCounts` call.
- At the two row-build sites (League rows ~L2255, Group rows ~L2289), use the cache value when defined and fall back to `unreadCounts?.groups[group.id] ?? 0`.

### 3. Existing invalidation paths
- `markChatScopeRead.ts` and other spots that currently mutate `unread-message-counts` cache should also invalidate `["chat-group-unread-cache", userId]` so opening a thread clears the row badge instantly (the DB trigger will follow via realtime, but the invalidation guarantees no flicker).
- No change to `useAuth.tsx` realtime — its notification-driven invalidations still keep the RPC-sourced totals in sync for other scopes.

## Out of scope
- No change to `get_unread_message_counts` RPC yet. Once this ships and is stable, we can revisit removing the `grps` CTE from the RPC as a follow-up.
- No change to the global inbox pill (BottomNav / AppHeader) — it still totals via the RPC.
- Team/club/DM row badges unchanged.

## Technical notes
- `chat_group_unread` schema: `(group_id uuid, user_id uuid, unread_count int, last_read_message_id uuid, updated_at timestamptz)`.
- RLS is already scoped to `user_id = auth.uid()`; the realtime filter is redundant server-side but reduces client-side event volume.
- The cache covers both "personal" chat groups and club/team/mini-league groups (triggers fire on all `group_messages` inserts), so both League and Group rows are handled by the same hook.
- Realtime payload for UPDATE gives us `new.unread_count` directly — no follow-up fetch.

## Rollback
Delete the hook, remove the two fallback lookups. Rows revert to reading `unreadCounts.groups[id]` from the RPC. Zero DB changes required to roll back.

## Files touched
- `src/hooks/useGroupChatUnreadCache.ts` (new, ~60 lines)
- `src/pages/MessagesPage.tsx` (2 small edits at row-build sites)
- `src/lib/markChatScopeRead.ts` (add one invalidation)
