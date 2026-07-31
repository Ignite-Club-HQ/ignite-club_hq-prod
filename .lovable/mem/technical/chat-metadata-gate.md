---
name: Chat metadata gate — never claim deleted on network failure
description: Chat pages must use resolveChatMetadataState + maybeSingle so a dropped connection shows "Try again", not "this chat group has been removed".
type: constraint
---
Chat metadata queries (`chat_groups`, `teams`, `club_admin_conversations`, `direct_conversations`, clubs) MUST:

1. Use `.maybeSingle()`, never `.single()` — `single()` throws on zero rows, collapsing "deleted" and "request failed" into the same `data === undefined`.
2. Gate rendering through `resolveChatMetadataState()` (`src/lib/chatMetadataGate.ts`), not `if (!data)`.
3. Render `<ChatUnreachable />` (retry affordance) for `unreachable`, and only show the "has been removed / not found" copy for `missing` (a **successful** query that returned no row while online).

**Why:** a notification tap during flaky coverage rendered "This chat group has been removed or is no longer available" for a live group, with no recovery other than force-quitting. Errored / paused / offline / aborted-zombie fetches are all recoverable states.

## Notification tap resolution
`resolveChatTargetResult()` (`src/lib/notificationChatRouting.ts`) returns `found | not_found | unreachable`. A failed table probe or `navigator.onLine === false` yields `unreachable` — callers must show a retry toast and stay put, NEVER redirect to `/messages`, because that reads as "the message was deleted". Only `not_found` (all six probes succeeded, empty, online) may use `NOTIFICATION_FALLBACK_PATH`. `resolveChatTargetForMessageId()` is a lossy back-compat wrapper; prefer the result form.
