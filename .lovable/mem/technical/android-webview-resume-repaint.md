---
name: Android WebView resume repaint wake
description: setupAndroidWebViewWake() forces compositor repaint on appStateChange isActive=true; without it Android shows blank dark screen until user taps
type: feature
---
Android WebView under Capacitor pauses its compositor and throttles RAF/setTimeout when backgrounded. On resume the view often stays on the last frame (or blank if Suspense fallbacks were mid-flight) until a touch event ticks the JS loop.

`src/lib/androidWebViewWake.ts` subscribes to `App.appStateChange` and on `isActive=true`:
1. Toggles `documentElement.style.transform = "translateZ(0)"` (invalidates compositor layer)
2. Forces reflow read, then restores transform in rAF
3. Dispatches `resize` at 0/120/600ms so visualViewport/layout hooks re-evaluate

Wired in `src/App.tsx` next to `setupReactQueryNativeAdapter()`. Safe no-op on iOS/web. Do NOT remove — symptom is full blank dark screen on resume that only clears on tap.
