---
name: Chat row height cache scroll gate
description: CachedMeasureRow signature effect must defer rAF/120ms/360ms writes and short-lived RO while chat scroller is active (getLastChatScrollAt < 250ms)
type: technical
---

In `src/components/chat/VirtualizedChatMessageList.tsx`, `CachedMeasureRow`'s signature-effect (mount + edit/reaction/preview hydration) must NOT eagerly fire its rAF / 120ms / 360ms `setCachedRowHeight` writes or its short-lived ResizeObserver while the chat scroller is active.

Gate via `getLastChatScrollAt()` from `@/lib/chatScrollActivity` (250ms threshold). If active, queue via `runWhenChatScrollIdle(scheduleSettleWrites, 250)` so writes happen after the user stops.

Why: each cache write invalidates Virtuoso's `itemSize` for that row, which triggers a positional correction. During a fast upward fling, ~12–20 overscan rows mount with `defaultItemHeight=160` then fire deferred writes — corrections continue after the user has visibly stopped, producing the "messages keep moving after I stop / messages stop mid-scroll" symptom that was most noticeable on Team Admins & Coaches and other busy image-heavy threads. Mount-time `write()` still runs synchronously so first paint is correct; only the late-settle writes are gated.
