---
name: Group chat reactions dual-store merge
description: GroupChatPage query payload keeps a FLAT reactions array, but ChatMessage optimistic reaction writes land on EMBEDDED message.reactions — the cache→localMessages sync must union both sources or tap-to-react vanishes until remount.
type: feature
---
Group chats (committee chats, BBQ/Canteen, etc.) render from `GroupChatPage`, whose `["group-messages", groupId]` query payload is `{ messages, hasOlderMessages, reactions }` — a FLAT top-level reactions array plus per-message embedded `reactions`.

Two writer families keep different halves current:
- `ChatMessage` optimistic add/remove (`updateReactionMessages`) writes ONLY embedded `messages[].reactions` in the cache (plus its own component-local state).
- Realtime `message_reactions` events go through `applyGroupReaction`/`applyGroupReactionDelete`, which update BOTH the flat array and (via `useRealtimeReactionSync.mutateStores`) the embedded arrays.

Rule: the cache→localMessages sync `useLayoutEffect` in `GroupChatPage` must derive each row's incoming reactions as the UNION of the flat-array entries and the embedded `message.reactions` (dedup by id; drop a user's leftover `temp-` row once the flat array holds their confirmed row), then pass the final merged list through `reconcileReactions(scope, …)` so recorded realtime deletes strip any stale rows revived by a late in-flight fetch. Trusting the flat array alone makes optimistic reactions invisible until exit/re-enter whenever realtime is slow.

Other chat pages (club/team/dm/broadcast/club_admin) embed reactions on messages and their sync effects already trust the embedded arrays — do not "port" the flat-array pattern to them.
