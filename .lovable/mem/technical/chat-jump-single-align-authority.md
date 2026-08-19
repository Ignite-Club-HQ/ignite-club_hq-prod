---
name: Chat jump reveal — single alignment authority + quiet composer inset
description: Why the jump-to-message reveal shifted down then up, and the invariants that prevent it (live bottomPadding, epsilon no-op, one finalAlign owner)
type: feature
---
Symptom: tapping a message notification reveals the thread from the skeleton, then the target row moves down and back up before settling.

Causes and invariants (`src/components/chat/VirtualizedChatMessageList.tsx`):

1. `alignMessageIdInView` MUST read the composer inset from `bottomPaddingRef.current`, never a closed-over `bottomPadding`. The content-reveal gate used the stale 56px composer floor while the overlay gate used the measured height, so the two computed different offsets and corrected each other.
2. `alignMessageIdInView` MUST no-op when the delta is < 2px. Any real scroll write re-arms the *other* gate's quiet window (its scroll/mutation observers see a new signature) and produces a late third correction.
3. Only ONE gate may issue `finalAlign` for a given target. The content gate claims it via `jumpAlignOwnedByContentGateRef`; the overlay gate's `finalAlign` returns early when the id matches.
4. Neither gate may unmask while the composer inset is still settling. `bottomPadding` is rendered as an in-flow Virtuoso footer and `ChatMessagesScroller` measures it in staggered 80/180/360/700ms passes, so any change physically moves the message column. `bottomPaddingQuiet(180)` gates the content-gate reveal (bounded by the 4s fail-safe) and stretches the overlay fade delay 80 → 220ms.
