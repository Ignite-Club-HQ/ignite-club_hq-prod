

# Fix Chat Scroll Jolt on Open

## Root Cause

The chat scroll container is **visible while layout is still settling**. The `useInitialChatBottomPin` hook takes 100-300ms to measure, scroll, and stabilize via ResizeObserver. During that window the user sees the chat at an incorrect scroll position, then it snaps to bottom — causing the visible "jolt".

Additional layout shift sources during this window:
- Profile avatar images loading asynchronously
- `--bottom-nav-offset` CSS variable set by AppLayout effect
- NotificationNudgeBanner appearing after async push status check
- `paddingBottom` changing based on keyboard state

## Solution: Hide-Until-Pinned

Keep the scroll container **invisible** (`visibility: hidden`) until the pin completes, then reveal it. This matches the "no jolt" preference — the user sees nothing briefly, then the chat appears already at the correct bottom position.

## Changes

### 1. Modify `useInitialChatBottomPin` to return `isPinned`

**File:** `src/hooks/useInitialChatBottomPin.ts`

- Change return type from `void` to `{ isPinned: boolean }`
- Add internal `useState(false)` for `isPinned`
- Set `isPinned = true` inside `notifyPinned()` (which fires after the ResizeObserver quiet period or fallback timeout)
- Reset `isPinned = false` when `resetKey` changes
- Add a safety timeout (800ms max) that forces `isPinned = true` even if settling hasn't completed, to avoid a permanent blank screen

### 2. Apply `visibility` to scroll containers on all 6 chat pages

**Files:**
- `src/pages/TeamChatPage.tsx`
- `src/pages/ClubChatPage.tsx`
- `src/pages/GroupChatPage.tsx`
- `src/pages/DirectMessagePage.tsx`
- `src/pages/BroadcastChatPage.tsx`
- `src/pages/ClubAdminChatPage.tsx`

On each page:
- Destructure `isPinned` from `useInitialChatBottomPin({ ... })`
- Add `style={{ visibility: isPinned ? 'visible' : 'hidden' }}` to the scroll container div (the one with `data-chat-scroll-lock="true"` and `ref={scrollAreaRef}`)
- This ensures the container is in the DOM and measurable (unlike `display: none`) but not painted until the scroll position is correct

### 3. No other changes needed

- The existing `onPinned` callbacks (enabling infinite scroll) continue to work unchanged
- NotificationNudgeBanner, keyboard handling, and all other systems remain as-is
- The `useChatViewportHeight` hook already initializes synchronously — no change needed

## Execution Summary

```text
useInitialChatBottomPin
  ├── mount → visibility: hidden
  ├── useLayoutEffect → snap to bottom
  ├── ResizeObserver → re-snap on layout changes
  ├── 120ms quiet period → finalize → visibility: visible
  └── 800ms safety cap → force visible
```

Two files modified (hook + 6 pages), zero new dependencies, zero behavioral changes to existing scroll/keyboard/banner logic.

