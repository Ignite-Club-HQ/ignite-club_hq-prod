# Messaging scoped-revocation finding

Date identified: 2026-07-26
Status: Documented; intentionally not fixed
Priority: Medium
Category: Privacy defence-in-depth and stale client state

## Summary

When a user loses access to one team, club, chat group, or direct/admin
conversation, `useAuthorizedScopes` detects the removed scope and calls
`revokeScope`. The realtime registry then removes the matching Supabase
Realtime channel.

The main chat pages register those channels without their React Query message
cache keys. Scoped channel revocation therefore cannot immediately evict the
already-loaded thread from React Query memory. The content can remain visible
until another lifecycle event removes or replaces it, such as navigation,
refetch, reload, sign-out, or account switching.

This finding does **not** establish that the user can continue reading or
writing messages through Supabase. Database RLS remains the authoritative
security boundary and must reject access after membership removal. The issue
is that previously fetched content may remain on screen longer than intended.

## Evidence

The following pages call `registerChannel` with a user and scope but no
`cacheKeys`:

- `TeamChatPage.tsx`
- `ClubChatPage.tsx`
- `GroupChatPage.tsx`
- `DirectMessagePage.tsx`
- `ClubAdminChatPage.tsx`
- `BroadcastChatPage.tsx` (global scope; lower membership-revocation relevance)

`realtimeChannelRegistry.ts` supports cache eviction, but only for query keys
provided through the optional `cacheKeys` registration field.

Sign-out and cross-user sign-in are separately protected: `useAuth` clears the
React Query client and invokes `clearUserScopedCaches`. The gap is specifically
the loss of an individual scope while the same user session remains active.

## User impact

- A removed member may continue seeing the already-rendered conversation until
  the page changes or refreshes.
- The UI can incorrectly appear to retain membership after the backend has
  revoked it.
- If mutation error handling is unclear, attempted sends may look confusing
  even when RLS correctly rejects them.
- Shared-device account switching is not the affected path; it has separate
  cache-clearing protection.

## Safe remediation design

1. Supply the relevant React Query message keys in each scoped
   `registerChannel` call.
2. Clear the matching persistent `messageCache` entry when a scope is revoked.
3. If the revoked scope is currently displayed, replace the thread with an
   access-revoked state and navigate back to the messages list.
4. Preserve the existing sign-out and account-switch clearing behavior.
5. Do not weaken or replace backend RLS with client-side checks.

The cache-key mapping should be defined centrally to prevent the six chat page
implementations drifting apart during future refactoring.

## Tests required before accepting a fix

- Losing a team scope tears down only that team's realtime channel.
- Its React Query thread and persistent message cache are immediately removed.
- Other authorized team, club, group, and DM threads remain intact.
- The currently open revoked thread can no longer display or submit content.
- A rejected post-revocation send restores any optimistic state and presents a
  clear access error.
- Sign-out and cross-user account switching continue clearing every user-scoped
  cache.
- Isolated local-Supabase tests confirm former members cannot select, insert,
  update, or delete messages after revocation.
- A two-user Playwright journey confirms the removed user's UI closes the
  thread while the remaining member continues normally.

## Current related coverage

- `useAuthorizedScopes.test.tsx` covers detection of removed scopes.
- `realtimeChannelRegistry.test.ts` covers targeted teardown and optional
  React Query cache eviction.
- `messageCache.characterization.test.ts` covers conversation isolation,
  deletion, ordering, deduplication, and targeted clearing.
- `messagesPageCache.characterization.test.ts` covers user isolation,
  partial updates, account switching, and sign-out clearing.

These tests reduce regression risk but do not yet provide the end-to-end
post-revocation guarantee described above.
