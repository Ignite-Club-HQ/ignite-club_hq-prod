---
name: Notification preload single-message guard
description: Chat pages must never seed localMessages or placeholderData from a 1-item cache — that cache is the push-notification preload and renders as a lone message stranded at the top of the viewport on cold start
type: technical
---

`preloadMessageFromNotification` (src/lib/notificationPreload.ts) writes a SINGLE message into the messageCache BEFORE any chat page mounts. If a chat page seeds its `localMessages` `useState` or returns it from react-query `placeholderData` without a length check, the cold-launch chat opens showing ONE message at the top with no history above it, then jolts when the real fetch resolves.

Rule for every chat page (Team / Group / Club / DM / Broadcast / ClubAdmin):

1. `placeholderData` from notification path: require `cached.length >= 5` (a real history window). Do NOT use `cached.length > prevLen` — on cold start `prevLen=0` so `1 > 0` always passes and defeats the guard.
2. `useState` initializer for `localMessages`: require `cached.length >= 2`, otherwise return `undefined`.
3. `showLoading`: gate on `hasMeaningfulLocal = (localMessages?.length ?? 0) >= 2`, not `!localMessages?.length`. A 1-item local cache must still show the loading state.

Companion: `EAGER_JUMP_ARM_TIMEOUT_MS` in src/lib/pendingChatJump.ts is 10s — slow Android cold starts can exceed 4s and the JumpHydrationSkeleton overlay never mounts if the timer auto-clears the flag first.
