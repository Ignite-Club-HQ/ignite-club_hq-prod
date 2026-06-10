---
name: Android prepend commit gate
description: useDeferPrependsWhileScrolling extra gating on Android — finger-off + 450ms idle + 1500ms max hold — fixes "messages jolt after I stop scrolling at top"
type: feature
---

`useDeferPrependsWhileScrolling` in `VirtualizedChatMessageList.tsx` holds prepend pages until the chat scroller is idle. On web that's 220 ms. On Android WebView we layer extra gates because `scrollTop=0` at the top edge stops emitting scroll events, so the 220 ms idle resolves the instant the user stops scrolling — Virtuoso then commits the page and the row mount + sync RO measure batch jolts visibly.

Android-only behaviour (`isAndroidNativeWebView()` true):
- Idle threshold raised to **450 ms**.
- Commit additionally requires `!isViewportTouching(scroller)` — never commit with finger on glass.
- Max hold **1500 ms** safety so a parked finger still eventually loads older history.
- Scroller is exposed to the module-level effect via a `scrollerElRefForPrepend` pointer set inside the component (mount/unmount).

Web path is unchanged — straight `runWhenChatScrollIdle(220)`.
