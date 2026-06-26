---
name: Chat Recap static-reveal on native
description: CatchMeUpSheet & GlobalChatRecapSheet disable per-char typewriter timers and lower fetch concurrency on Capacitor native to prevent Android WebView white-screen crashes
type: feature
---
On Android WebView, the Chat Recap sheets used to render ~20–40 concurrent `Typed`/`Reveal` components each driving a `setInterval(16ms)` per character, on top of a `setInterval(28ms)` per LoadingTypewriter line, while large edge-function payloads landed. This saturated the main thread and OOM'd the WebView to a blank white screen mid-load.

Mitigations (do NOT revert):
1. `CatchMeUpSheet` has `useStaticReveal()` → true on `Capacitor.isNativePlatform()` or `prefers-reduced-motion: reduce`. Static mode sets `CHAR_MS=0/GAP_MS=0`, makes `Typed`/`Reveal`/`TypewriterLine` render their full content immediately with NO timers.
2. `GlobalChatRecapSheet` `CONCURRENCY = isNativePlatform() ? 2 : 4` — caps parallel `summarize-chat`/`assemble-catchup` invocations on native to halve peak memory pressure.

Web (and non-native preview) keeps the original animated typewriter and 4-up concurrency.
