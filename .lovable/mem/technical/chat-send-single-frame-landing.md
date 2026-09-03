---
name: Chat send must land in one frame (no smooth pins, sync composer height)
description: Post-send shake root causes — animated bottom pins get cancelled by instant writes; composer height/footer/row must commit in the same frame
type: constraint
---

Symptom (2026-09-03): after tapping Send the thread stepped down then up (or
glided then jumped) for a few hundred ms.

Root causes, all "the row, the composer collapse and the list footer landed on
different frames":

1. A `behavior: "smooth"` bottom pin ("gentle" first pin) is cancelled by the
   next synchronous `scrollTop =` write (own-message pin, bottom-padding
   re-pin, stay-pinned RO). Truncated glide + instant jump reads as a jerk.
   **`pinToTrueBottom` must NEVER animate.** All bottom pins are instant.
2. `useMeasuredElementHeight` measured the composer in RO → rAF, so the
   footer (Virtuoso `bottomPadding`) lagged the composer DOM by 1+ frames.
   It now measures in a deps-less `useLayoutEffect` (same commit) and
   directly inside the RO callback (no rAF).
3. `MentionInput` autosized the textarea in a rAF after `value` changed; it
   now runs `adjustHeight` in `useLayoutEffect` (IME guard stays inside
   `adjustHeight`).
4. `useDebouncedNumber(value, 0)` routed through state + passive effect;
   with delay 0 it returns `value` directly.
5. React Query notifies on `setTimeout(0)`, so the optimistic row reached
   `localMessages` a task after the composer had already cleared. Team/Group/
   Club/Broadcast `onMutate` now append the optimistic row to
   `setLocalMessages` in the same batch as `setMessage("")` (cache sync
   dedupes by id).

Do not re-add animated pins or rAF-deferred composer measurement to make
sends "feel smoother" — it recreates the shake.
