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

Symptom (2026-08-22, "STILL moving up and down after skeleton reveal"): the
movement was no longer a mask regression but an UNMASKED pin sequence. On a
cold open with an empty React Query cache (group/committee chats after app
launch or a club switch — the common case), the list mounts with
`messages=[]` and the empty branch's 700ms grace calls
`setInitialRevealReady(true)` while the page-level skeleton still covers the
thread. That empty reveal armed the one-way `hasRevealedOnceRef` latch, so
when the real messages landed (>700ms fetch), `armRevealMask()` was a no-op
and the entire bottom-pin stabilisation sequence — immediate/raf1/raf2 pins,
per-frame stability checks, reveal-final/settle pins, plus Virtuoso's
end-align park (maxTop - footer) → true-maxTop correction — played out
visibly for seconds.

Fix (two parts):
4. The latch may only arm once CONTENT painted, and only from a PASSIVE
   effect (`useEffect`), never during render. A render-phase latch arms the
   moment `initialRevealReady && messages.length > 0` is true — BEFORE the
   pin layout effect of the same commit can call `armRevealMask()`. The
   passive effect runs after all layout effects, so the pin effect always
   wins the race. An empty-state reveal has nothing on screen to protect and
   must never disarm re-masking.
5. The pin sequence skips re-masking when content fits inside the viewport
   (`scrollHeight <= clientHeight + 1` — empty→first-message in an open
   thread): maxTop is 0 there, every pin is a no-op, and masking would just
   flash a skeleton over the empty state. Missing/zero-sized scroller
   defaults to masking (an unmeasurable layout can't prove pins are no-ops).

Symptom (2026-08-23, movement limited to newly arrived images/replies):
6. Image ratios must be clamped identically in the upload/cache, estimator,
   and rendered media box. A novel image must not change its mounted row's
   aspect ratio after decode; cache the measured ratio for future mounts.
7. Realtime reply messages must resolve `reply_to_id` synchronously from the
   already-loaded message window before rendering. Only fetch the reply target
   when it is genuinely absent locally; never paint null then patch it later.
8. `ChatMessagesScroller` must seed its last-message tracking ref from the
   current tail. Initial populated render is a baseline, not an append, and
   must not schedule the post-append timer pin sequence after reveal.

Symptom (2026-08-24, notification-tap reveal still drifts for seconds):
9. The stay-pinned RO guard and open-pin window are gated on
   `initialBottomPinned`, which every deep-link page passes as `false` — so
   after a jump reveal NOTHING compensated late hydration (read receipts land
   2-4s on cold start, reactions, link previews). Fix: POST-REVEAL JUMP ANCHOR
   effect — armed by the content gate in `finish()` via `postJumpAnchorRef` +
   `jumpAnchorNonce` BEFORE unmask (and resets `userHasScrolledAfterPinRef`
   so repeat jumps in an open chat get a full window). For 6s it re-runs
   `alignMessageIdInView(target, "end")` on any geometry change (signature-
   gated), retiring on the first user scroll gesture. Do NOT fix this class
   by lengthening the pre-reveal mask — that reintroduces the multi-second
   blank chat `chatJumpReveal.ts` was built to kill.

Regression tests: `VirtualizedChatMessageList.emptyMount.test.tsx` —
"cold-open: an empty-state reveal must NOT disarm re-masking when messages
land"; `src/test/chatPostRevealAnchor.guard.test.ts` — anchor arming, glue
alignment, user-scroll retirement, no-mask-extension invariants.
