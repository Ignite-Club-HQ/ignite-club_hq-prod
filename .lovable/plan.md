## Goal

Remove the legacy non-virtualised chat scroller everywhere. `VirtualizedChatMessageList` becomes the only message list. Manual `scrollTop` anchoring, `ResizeObserver` height compensation, and the `ff:chat-virtualization` flag all go away.

This lifts the existing Core memory rule that says "Legacy mapped scroller path and its refs must remain intact." Memory will be updated at the end.

## Scope (files affected)

Delete:
- `src/components/chat/ChatMessagesScroller.tsx` legacy branch (lines 219–244) — keep only the Virtuoso branch
- `src/lib/chatScrollActivity.ts` — `observeChatElementHeight`, `runWhenChatScrollIdle`, scroll-activity tracking
- `src/lib/featureFlags/chatVirtualization.ts`
- `src/hooks/useChatVirtualizationFlag.ts`
- `src/hooks/useChatOlderMessagesAnchor.ts`
- `src/hooks/useInitialChatBottomPin.ts` and its regression test
- `src/hooks/useChatAutoScrollToLatest.ts`
- The chat-virtualisation toggle row in `src/pages/AppSettingsPage.tsx`

Modify:
- `src/components/chat/ChatMessagesScroller.tsx` — single Virtuoso path, drop `scrollAreaRef` / `loadTriggerRef` / `messagesEndRef` / `endElementId` / `loadTriggerStyle` / `isPinned` props (Virtuoso owns scroll state)
- `src/components/chat/ChatMessage.tsx` — remove `observeChatElementHeight` call; keep `overflowAnchor: 'none'` and `chat-bubble-stable` class
- `src/components/chat/GroupChatMessageRow.tsx` — same as above
- `src/components/chat/LinkPreview.tsx`, `MessageReactions.tsx`, `ReplyPreview.tsx` — replace `runWhenChatScrollIdle(cb)` with `requestIdleCallback`/`setTimeout` fallback (preview/reactions just need to defer expensive work after first paint, not after a custom scroll-idle signal)
- All chat pages (`TeamChatPage`, `ClubChatPage`, `GroupChatPage`, `BroadcastChatPage`, `DirectMessagePage`, `ClubAdminChatPage`) — remove `useChatVirtualizationFlag`, the three legacy hooks, and the refs/props they fed into the scroller. Keep `composerHeight`, `searchOpen`, `isKeyboardOpen`, `isNativeIOS` — Virtuoso still needs those.
- `src/lib/chatScrollIntent.ts` — audit; remove if unused after page edits, keep if Virtuoso still needs the intent signal.
- `src/components/MediaCommentSheet.tsx` — only references `messagesEndRef` for its own internal list, unrelated to chat scroller; leave alone unless it imports a removed hook (verify).
- `src/index.css` — drop CSS targeting legacy refs (`[data-chat-scroll-lock]` rules) if any are scroller-specific.

## Search behaviour

Search mode currently falls back to the legacy DOM so jump-to-message works. After this change, search uses Virtuoso's `scrollToIndex({ index, align: 'center' })` via the existing `VirtualizedChatMessageListHandle`. The handle already exposes the imperative API; pages only need to call it from their search-result tap handler instead of relying on the message node being in the DOM.

## Memory updates

- Remove the Core line about legacy scroller being preserved.
- Replace the `Chat Virtualisation Flag` memory with a `Chat Scroller` memory: "Virtuoso is the only chat list. No manual scrollTop anchoring. No feature flag."
- Remove the index entry for the old flag memory and add the new one.

## Verification

1. Type-check passes (harness runs the build automatically).
2. Manual smoke on Team/Group/Club/Broadcast/DM/ClubAdmin chats:
   - Open thread → starts pinned to bottom.
   - Send a message → auto-scrolls to bottom.
   - Fast-scroll up → no downward settle, no bubble flicker.
   - Open keyboard → bottom message stays visible above composer.
   - Reply / edit → composer grows, latest message stays visible.
   - Search → tap result → jumps to that message.
   - Load older → fetches and prepends without scroll jump.
3. Run the existing chat e2e/regression specs; delete the iOS bottom-pin regression test (its subject is removed) and add no replacement unless an equivalent assertion is missing for the Virtuoso path.

## Technical notes

- Removing `useInitialChatBottomPin` is safe because `VirtualizedChatMessageList` already accepts `initialBottomPinned` and Virtuoso's `followOutput` handles bottom-stickiness.
- Removing `useChatOlderMessagesAnchor` is safe because Virtuoso's `startReached` + `firstItemIndex` model preserves scroll anchoring during prepend natively.
- Removing `useChatAutoScrollToLatest` is safe because the existing keyboard/composer re-pin effect inside `ChatMessagesScroller` (lines 117–165) already covers send/keyboard/reply scenarios via the Virtuoso handle.
- `chatScrollActivity` exists purely to coordinate with the legacy mutable `scrollTop`. With Virtuoso in charge, deferred work can use `requestIdleCallback` (with a `setTimeout(…, 200)` fallback for Safari) — no custom scroll-idle bus needed.

## Risk

High blast radius: 6 chat pages, 3 hooks, 1 lib, 1 flag, 1 toggle UI, 1 regression test, plus row component cleanups. Estimated ~15 files. Most edits are mechanical deletions; the only judgment call is the search jump-to-message wiring on each page (Virtuoso `scrollToIndex` from search-result handler).
