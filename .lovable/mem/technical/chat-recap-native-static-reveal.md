---
name: Chat Recap native typewriter cadence
description: CatchMeUpSheet runs the typewriter on Capacitor native (Android/iOS) with a slightly slower per-char cadence; GlobalChatRecapSheet keeps fetch concurrency low on native to avoid Android WebView white-screen crashes
type: feature
---
History: We previously force-disabled the per-char typewriter on native via `useStaticReveal` because the original implementation ran 20–40 concurrent `setInterval(16ms)` typewriters on top of a `setInterval(28ms)` loading line while large edge-function payloads landed — Android WebView OOM'd to a white screen.

Root cause was interval count × payload size, NOT animation itself. User feedback (2026‑06‑28): "typewriter effect is not happening on android". We re-enabled the animation on native with mitigations:

1. `useStaticReveal()` in `CatchMeUpSheet.tsx` now ONLY returns true for `prefers-reduced-motion: reduce`. Native no longer forces static mode.
2. Native uses a slower per-character cadence: `CHAR_MS = 22` on native vs `16` on web. Keeps main-thread work modest while still showing the effect.
3. `GlobalChatRecapSheet` keeps `CONCURRENCY = isNativePlatform() ? 2 : 4` — do NOT raise this on native; it caps parallel `summarize-chat`/`assemble-catchup` invocations to halve peak memory pressure during the recap render.
4. `useStaticReveal` is preserved so users with reduced-motion preference still get instant render.

If Android crashes recur during recap rendering, the right lever is concurrency (#3) or chunked rAF rendering — NOT re-disabling animation on native. Don't revert #1/#2.
