---
name: Chat Virtualization Upward Overscan
description: Virtuoso increaseViewportBy.top tuned to 600 / minOverscanItemCount.top:6 to stop post-stop jolt from above-viewport hydration
type: technical
---
`VirtualizedChatMessageList` sets `increaseViewportBy={{ top: 600, bottom: 240 }}` and `minOverscanItemCount={{ top: 6, bottom: 2 }}`.

Why not larger upward overscan: previously top:1600 / top:12. After a fast upward flick STOPS, those overscan rows above the viewport were still hydrating async children (images, link previews, deferred reactions). Each late growth above the viewport made Virtuoso re-correct paddingTop, which user perceived as the chat "moving around after it has stopped scrolling".

Keep ~one screen of upward overscan so the NEXT flick still lands in measured territory, but no more. Do not raise without confirming post-stop quiescence is still flat.
