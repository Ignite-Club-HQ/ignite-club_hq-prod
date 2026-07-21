# Realtime Channel + Membership Audit

Scope: identify every `supabase.channel(...)` subscription in the client and classify
its exposure to stale-membership payload leaks. Companion to the registry + membership
hook introduced in this pass.

## Threat model

After a user is removed from a club/team/group (kick, leave, role revocation, club
deletion), REST reads are correctly denied by RLS. The remaining risk vectors are:

1. **Stale Realtime subscriptions** — a channel opened while the user was a member
   keeps delivering `postgres_changes` payloads until the client explicitly
   `removeChannel`s it. RLS is evaluated at subscribe time, not per event.
2. **Fail-open callback filters** — inbox handlers use
   `if (ids.size && !ids.has(row.x)) return;`. When `ids` is empty (initial load,
   error, revoked-all state) the guard collapses and every payload passes.
3. **Cache residue** — even after the channel is torn down, previously cached
   messages/threads stay in React Query until the user navigates or the query
   staleTime expires.

## Channel inventory

Broad ⇒ subscribes without scope filter; must filter in callback.
Scoped ⇒ subscribes with `filter: 'x=eq.<id>'`; RLS still validated at subscribe.
User ⇒ tied to `auth.uid()` only, no club/team/group scope.

| File | Channel | Type | Scope | Membership-sensitive |
|------|---------|------|-------|----------------------|
| `pages/MessagesPage.tsx:1562` | `messages-inbox-${user.id}` | Broad | team/club/group INSERT | **YES — fail-open** |
| `pages/MessagesPage.tsx:1756` | `messages-inbox-light-${user.id}` | Broad | team/club/group INSERT | **YES — fail-open** |
| `hooks/useGroupChatUnreadCache.ts:57,108,118` | `chat-group-unread*-${userId}` | Broad | group INSERT + reads | **YES** |
| `pages/TeamChatPage.tsx:1224` | `team-messages-${teamId}` | Scoped | team | Yes (revocation) |
| `pages/ClubChatPage.tsx:998` | `club-messages-${clubId}` | Scoped | club | Yes |
| `pages/GroupChatPage.tsx:1253` | `group-messages-${groupId}` | Scoped | group | Yes |
| `pages/DirectMessagePage.tsx:1108` | `dm-${conversationId}` | Scoped | DM participants | Yes (block/unmatch) |
| `pages/ClubAdminChatPage.tsx:746` | `club-admin-chat-${conversationId}` | Scoped | admin thread | Yes |
| `pages/BroadcastChatPage.tsx:631` | `broadcast-messages-realtime` | Broad | app admins | Role-sensitive |
| `hooks/useChatPinnedVault.ts:56` | `chat-pinned-vault-${chatType}-${chatId}` | Scoped | chat | Yes |
| `hooks/useMessageReads.ts:311` | `message-reads-${type}-${contextId}` | Scoped | chat | Yes |
| `hooks/usePinnedMessages.ts:107` | `pinned-${chatType}-${chatId}` | Scoped | chat | Yes |
| `hooks/useRemoteFillInSync.ts:89` | `soccer-fillins-${teamId}` | Scoped | team | Yes |
| `hooks/useEventGroupSync.ts:154` | `event-group:${groupId}` | Scoped | group | Yes |
| `components/chat/BoardLinkCard.tsx:46` | `board-card-${gameId}` | Scoped | game | Yes |
| `components/chat/PollCard.tsx:69` | `poll-${pollId}` | Scoped | poll | Yes |
| `pages/MediaPage.tsx:646,914` | `media-feed-${user.id}` / `media-comments-${user.id}` | User | own media | User-scoped only |
| `hooks/useAuth.tsx:848` | `notifications-realtime` | User | own notifications | User-scoped only |
| `pages/NotificationsPage.tsx:308` | `notifications-realtime` | User | own notifications | User-scoped only |
| `hooks/useRealtimePerfSampler.ts:52,61` | `perf-*` | User/global | perf sampling | Low risk |
| `hooks/useUserPresence.ts:167` | `PRESENCE_CHANNEL` | Presence | app-wide | Low (presence only) |
| `hooks/useTypingIndicator.ts:23` | `typing:${channelName}` | Broadcast | chat | Yes (leak of typing state) |
| `pages/AdminActiveGamesPage.tsx:168` | `admin-active-games` | Broad | app admin | Role-gated route |
| `pages/ClubUpgradePage.tsx:250` | `club-sub-${clubId}` | Scoped | club billing | Yes (admin only) |
| `hooks/useChatBasicChunkSize.ts` etc. | `app-settings-*` | Global | app_settings | Public setting — OK |
| `lib/scheduleBroadcast.ts:45` | `schedule-broadcasts:${clubIds}` | Scoped | scheduled msgs | Yes |
| `lib/memberCheckout.ts:151` | `payment-${paymentId}` | Scoped | own payment | User-scoped |
| `hooks/usePhotoViews.ts:196` | dynamic | Scoped | photo | Yes |
| `pages/RealtimeHealthPage.tsx:41` | `app-presence` | Diagnostic | admin | Low |

**Fail-open callbacks found:** `MessagesPage.tsx` lines 1566, 1580, 1588, 1761, 1789,
1813 — six sites, all in the two inbox channels above.

## Backend gap assessment

- REST reads: RLS already denies. No backend change required.
- Realtime subscribe: RLS gates the initial subscription. No backend change required.
- Realtime *events on an already-open channel*: cannot be revoked server-side without
  the client tearing the channel down. This is the enforcement gap that the
  registry + membership hook close on the client.

Conclusion: **frontend-only**. No new RLS policies, RPCs or edge functions required.

## Fix strategy (subsequent passes)

- **Pass (b)** — MessagesPage inbox: replace fail-open guards with fail-closed guards
  driven by `useAuthorizedScopes` status. Empty/loading/failed ⇒ drop the payload.
- **Pass (c)** — Route scoped chat pages (Team/Club/Group/DM/ClubAdmin) through
  `realtimeChannelRegistry` so membership revocation triggers `revokeScope(...)`,
  which removes the channel and clears associated React Query keys in one call.
- **Pass (d)** — Regression tests for the registry, the hook, and the fail-closed
  inbox behaviour.

## Registry API (introduced in this pass)

```ts
registerChannel({
  key,               // stable id, e.g. `team-messages:${teamId}`
  channel,           // the RealtimeChannel returned by supabase.channel(...)
  userId,            // owning user
  scope,             // { kind: 'team'|'club'|'group'|'dm'|'user', id: string }
  cacheKeys?,        // React Query keys to remove on revoke
});
revokeScope(userId, scope);       // tears down + clears cache
revokeAllForUser(userId);         // sign-out / user swap
unregisterChannel(key);           // normal unmount
```

## Membership hook (introduced in this pass)

```ts
const { status, clubIds, teamIds, groupIds } = useAuthorizedScopes();
// status: 'loading' | 'ready' | 'failed'
// Fail-closed rule for callers:
//   if (status !== 'ready') return; // drop payload
//   if (!clubIds.has(row.club_id)) return;
```

`ready + empty set` explicitly means "no memberships" and payloads MUST be dropped —
never treated as "allow all". This is the inverse of the existing `ids.size && …`
pattern.
