---
name: Chat notification double-reveal (flash then reveal)
description: Two causes of "content appears, hides, reveals again" when opening a chat from a push tap — App-level Suspense wipe and premature reveal before the jump target loads
type: feature
---
Symptom: tapping a message push notification shows the thread, it flashes/blanks, then reveals again.

Cause 1 — Suspense wipe. Every routed page is `lazy()`. `AppLayout` opened its auth/theme gate and rendered `<Outlet/>` with NO local Suspense boundary, so a still-pending chat chunk suspended the commit and bubbled to the single App-level `<Suspense>` in `App.tsx`, unmounting the already-painted layout (header/nav) and swapping in the bare `PageLoader`, then remounting everything. Fix: `AppLayout` wraps `<Outlet/>` in its own `Suspense` (spinner inside `<main>`, chrome preserved). Never remove it.

Cause 2 — premature reveal on fallback anchor. `VirtualizedChatMessageList`'s bottom-pin layout effect used to `setInitialRevealReady(true)` via the `!initialBottomPinned` shortcut whenever `initialTargetMessageId` was set but the row wasn't in the loaded window yet. Content painted at LAST; then the chat page's `hydrateTargetWindow()` merged the target window and bumped `jumpRenderNonce`, which is embedded in `scrollerKey` — the React `key` of the list in TeamChatPage/ClubChatPage/GroupChatPage — remounting the list and restarting the skeleton. Fix: when `initialTargetMessageId && initialTargetIndex < 0`, hold the mask (bounded by `chatJumpLifecycleRemaining`, 400–3000ms) instead of revealing, so the remount happens while still masked.
