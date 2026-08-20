---
name: Chat skeletons never regress after first paint
description: Root causes and invariants for the "messages appear, flash blank, skeleton, appear again" bug on opening chat threads
type: constraint
---

Symptom (2026-08-20): opening a thread — especially just after a new message
arrives — painted messages, flashed blank, went back to the skeleton, then
revealed again. Three independent causes, all "a gate that already resolved
regressed":

1. `VirtualizedChatMessageList`'s `initialRevealReady` was re-armed to `false`
   whenever `bottomPinRevision` bumped. The `alreadyRevealedAndStable` guard on
   the anchor-reset effect only covers an UNCHANGED tail, so any new message
   (new `lastMessageId`) landing together with an anchor reset defeated it.
   Fix: one-way `hasRevealedOnceRef` latch + `armRevealMask()` — re-pinning and
   aligning stay allowed, re-masking does not. Never call
   `setInitialRevealReady(false)` directly; use `armRevealMask()`.

2. Parent pages bumped `jumpRenderNonce` unconditionally at the end of
   `hydrateTargetWindow()`, which is embedded in `scrollerKey` and force-remounts
   the list over already-painted content. Only bump it when the target row was
   NOT already in `localMessagesRef`.

3. Page-level `showLoading` could flip back to `true` because the
   `localMessages` reset effect (plain `useEffect`, post-paint) can transiently
   reseed a sub-threshold list while a realtime invalidation has the messages
   query in flight. Fix: `src/hooks/useChatLoadingLatch.ts` — once a thread has
   painted, the skeleton never returns for that thread id. Applied in
   TeamChatPage / ClubChatPage / GroupChatPage. `ClubAdminChatPage`'s
   `!conversation` full-page skeleton is likewise gated on having no
   `localMessages`.
