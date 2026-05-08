# Virtualised Chat History (feature-flagged)

Long threads (300+ messages) currently render every bubble, causing dropped frames during fast upward flicks and stutters when `flushSync` commits a new page. Goal: Telegram/Discord-smooth scrolling on 2000+ messages without regressing the existing pagination, anchoring, keyboard, or media behaviour.

## Approach

Build a new `VirtualizedChatMessageList` component using `react-virtuoso` (battle-tested for chat: variable heights, reverse infinite, anchored prepend) and gate it behind a feature flag. The current non-virtualised list stays the default until the new path is verified across Team / Group / Club / Broadcast chats on iOS, Android and desktop.

## Scope

Pages affected (gated, no behaviour change when flag off):
- `TeamChatPage`, `GroupChatPage`, `ClubChatPage`, `BroadcastChatPage`

Hooks/lib affected:
- New: `src/components/chat/VirtualizedChatMessageList.tsx`
- New: `src/lib/featureFlags/chatVirtualization.ts` (localStorage + env override)
- New: `src/hooks/useChatVirtualizationFlag.ts`
- Reuse unchanged: pagination loaders, `useChatUserScrollIntent`, `useChatAutoScrollToLatest`, `chatScroll.ts`, `useChatOlderMessagesAnchor.ts` (kept for the legacy path)

Out of scope: changing the message data model, message bubble component internals, reaction/edit/poll behaviour, server APIs.

## Feature flag

```ts
// src/lib/featureFlags/chatVirtualization.ts
const KEY = "ff:chat-virtualization";
export const isChatVirtualizationEnabled = () =>
  localStorage.getItem(KEY) === "1" || import.meta.env.VITE_CHAT_VIRTUALIZATION === "1";
export const setChatVirtualization = (on: boolean) =>
  localStorage.setItem(KEY, on ? "1" : "0");
```

Exposed via Admin → App Settings as a per-device toggle so we can dogfood without a deploy. Defaults OFF.

## Component design

`VirtualizedChatMessageList` is a thin wrapper around `Virtuoso` configured for reverse chat:

- `firstItemIndex` shifted down on each prepend → virtuoso preserves exact scroll anchor without manual `scrollTop` math
- `initialTopMostItemIndex={messages.length - 1}` → mounts pinned to latest
- `startReached={loadOlder}` → upward infinite pagination (drop-in replacement for the IntersectionObserver in `useChatOlderMessagesAnchor`)
- `followOutput={(atBottom) => atBottom ? "smooth" : false}` → preserves "do not auto-scroll while reading history"; new-message indicator shown when `!atBottom && newSinceVisible > 0`
- `atBottomStateChange` drives the existing jump-to-latest button + unread-since-visible counter
- `computeItemKey={(_, m) => m.id}` → stable keys, no full-thread rerenders
- `increaseViewportBy={{ top: 1200, bottom: 600 }}` → matches the current 1200px prefetch margin

### Variable heights & media

Virtuoso measures heights automatically, but image/video bubbles must reserve their final dimensions before load to avoid measure → relayout → jump cycles:

- `MessageContent` already receives image metadata (width/height) from upload — confirm and pass through as `aspect-ratio` + fixed `width: 100%; max-width: …` wrapper. If width/height missing on legacy rows, fall back to a placeholder box sized from `media_meta` JSON column (already populated by `usePublishChatImage`). This is the only message-bubble change.
- For thumbnails without metadata, render inside a `<div style={{ aspectRatio: "4/3" }}>` placeholder so virtuoso's first measurement is stable.
- Cache resolved heights keyed by message id in a `Map` ref so re-mount during scroll doesn't re-measure from scratch (virtuoso supports this via `itemSize` callbacks but its internal cache is usually enough — only add if profiling shows churn).

### Reactions, edits, timestamps, unread markers, grouping

These are properties of the message row, not the list. The existing `ChatMessage` / `GroupChatMessageRow` is rendered as the virtuoso item. Grouping (consecutive same-sender bubbles) is already computed up-front from the messages array — pass the precomputed `isGroupedWithPrev/Next` flags so virtuoso row keys stay stable when neighbours change.

Date separators and the unread divider are inserted into the array as synthetic items with stable ids (`date:2026-05-08`, `unread-divider`) so they participate in virtualisation rather than being absolute-positioned overlays.

### Keyboard / composer

Virtuoso's outer scroller replaces the current scrollable div. We set `style={{ height: "100%" }}` and let the existing chat layout (100dvh, `pt-safe`, composer at bottom) wrap it unchanged. `useChatViewportHeight` and `useNativeIOSKeyboardState` continue to drive the parent height; no virtuoso-specific keyboard logic needed. Verify on Android (per memory: avoid `scrollIntoView`) — virtuoso uses `scrollTo`, which is fine.

### Jump-to-latest

```ts
virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, behavior: "auto", align: "end" });
```

Triggered by the existing FAB and by send. We expose this via `useImperativeHandle` so call-sites don't change.

## Page integration

Each chat page renders:

```tsx
const useVirtualized = useChatVirtualizationFlag();

return useVirtualized ? (
  <VirtualizedChatMessageList
    ref={listRef}
    messages={messages}
    hasOlder={hasOlderMessages}
    isLoadingOlder={isLoadingOlder}
    onLoadOlder={loadOlder}
    renderItem={renderMessage}
    onAtBottomChange={setAtBottom}
  />
) : (
  /* existing list, unchanged */
);
```

The `messages`, `loadOlder`, `hasOlderMessages` API is identical to today, so the legacy path is the fallback.

## Testing matrix

Manual + scripted:
- Thread sizes: 100, 300, 1000, 2000 messages (seed via existing dev fixtures + a new `scripts/seed-chat-thread.ts` that pushes N synthetic messages into a dev team chat)
- Devices: iOS Safari (notch), Android Chrome WebView, desktop Chrome
- Scenarios:
  1. Cold open → pinned to latest, no upward jolt (existing regression case)
  2. Fast upward flick across 5+ pages → no viewport jumps, anchor exact
  3. Send while scrolled up → new-message indicator, no auto-scroll
  4. Tap indicator → smooth jump to latest
  5. Image-heavy page (10 photos) → no layout shift after decode
  6. Open keyboard mid-scroll → composer animation doesn't yank list
  7. Reply / edit → existing banners work
  8. Reactions / pin / delete → row updates without re-measuring neighbours
  9. Offline send queue + reconnect → ordering preserved

Automated:
- Extend `e2e/chat-bottom-pin.webkit.spec.ts` with a `?ff=virtualization` variant covering scenarios 1–4
- Vitest unit test for the synthetic-row insertion (date separators / unread divider) ordering
- Performance probe: `browser--performance_profile` before/after on a 1000-message seeded thread; record long-task count and dropped frames in PR description

## Rollout

1. Ship behind flag, default OFF
2. Enable for internal admins via Admin Settings toggle
3. Dogfood 1 week, fix issues
4. Default ON for new sessions, keep flag for emergency disable
5. Remove legacy path + `useChatOlderMessagesAnchor.ts` after 2 stable releases

## Risks & mitigations

- **Virtuoso measurement quirk on iOS WebView when keyboard opens**: covered by existing `useChatViewportHeight` 100dvh enforcement; verify in scenario 6
- **Reaction popovers / long-press menus** anchored to a row that scrolls out of the virtual window: virtuoso keeps mounted rows in DOM within `increaseViewportBy`; popovers must portal to body (already do via Radix) so dismissal works
- **Media height unknown for legacy messages without `media_meta`**: aspect-ratio placeholder fallback; one-time backfill script optional, not required
- **Bundle size**: `react-virtuoso` ~30 KB gz, acceptable

## Deliverables

1. `react-virtuoso` dependency added
2. Feature flag module + admin toggle
3. `VirtualizedChatMessageList` component
4. Synthetic date/unread row insertion helper
5. Page wiring on 4 chat pages
6. Updated e2e + perf snapshot
7. Memory entry documenting the flag and rollout state
