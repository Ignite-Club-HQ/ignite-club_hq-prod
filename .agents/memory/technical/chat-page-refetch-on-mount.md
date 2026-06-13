---
name: Chat pages must use refetchOnMount "always"
description: All chat-message React Query hooks set staleTime 5min — refetchOnMount must be "always", not true, or stale cache silently hides reactions/messages received while user was on another page
type: preference
---
All chat message queries (TeamChatPage, ClubChatPage, ClubAdminChatPage, BroadcastChatPage, GroupChatPage, DirectMessagePage) carry `staleTime: 5 * 60 * 1000`. With React Query, `refetchOnMount: true` only refetches when the cache is stale — within the 5-min window, revisiting the chat reuses cached messages WITHOUT any reaction/message inserted while the user was elsewhere (the realtime channel only picks up events from the moment it subscribes, which is on chat mount).

**Why:** Caused user-reported bug "I got a notification that Justin reacted but no reaction visible" — reaction was in DB, the page just never refetched.

**How to apply:** Always use `refetchOnMount: "always"` for chat message queries. Never downgrade to `true` even if it looks equivalent.
