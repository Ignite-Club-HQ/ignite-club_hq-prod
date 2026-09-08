---
name: Chat bottom pins converge on pinToTrueBottom
description: All chat bottom-pin writers must write scrollTop = maxTop (footer included) in a single synchronous write — never scrollToIndex(LAST, end)
type: constraint
---

Symptom (2026-08-22): after the skeleton reveal, chat threads visibly moved
up and down by the footer height (~32px).

Root cause: two competing "bottom" targets —
  A) `scrollToIndex({ index: "LAST", align: "end" })` parks the last ROW flush
     with the viewport bottom = maxTop - footerHeight (the bottomPadding
     footer sits below the viewport).
  B) direct `scrollTop = scrollHeight - clientHeight` writes park at maxTop.

Invariants:
- EVERY bottom pin in `VirtualizedChatMessageList` goes through
  `pinToTrueBottom(reason)` — a single synchronous `scrollTop = maxTop`
  write. This includes the imperative `scrollToBottom` handle, the reveal
  sequence (immediate/raf1/raf2/reveal-final/settle), the stay-pinned
  ResizeObserver guard, and the open-pin window.
- The stay-pinned RO judges "parked at bottom" against PRE-RESIZE geometry
  (lastScrollHeight/lastClientHeight), not post-resize.
- STAY_PINNED_MS = OPEN_PIN_WINDOW_MS = 6000 so late-hydrating read receipts
  (2–4s on cold start) are compensated before the guards retire.

Related: the reveal latch that protects this mask lifecycle must only arm on
painted content — see mem://technical/chat-skeleton-no-regression (cause 4).
