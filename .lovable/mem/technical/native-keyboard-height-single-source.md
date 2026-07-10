---
name: Native keyboard height single source of truth
description: useNativeKeyboardHeight passes through per-platform hooks. Android computeHeight must trust the Capacitor plugin height, not visualViewport-derived vvTotalInset (which can inflate when baseline drifts).
type: constraint
---
`useNativeAndroidKeyboardState` reconciles Android IME height from two signals:
1. Capacitor Keyboard plugin `keyboardHeight` (raw → CSS px if it looks like device px)
2. `visualViewport.height` (as a fallback/augment signal, NEVER an inflator)

**HARD RULE: the Capacitor plugin value is the ground truth.** It comes from Android's `InputMethodManager` and reports the actual keyboard height in CSS px (after DPR conversion). `visualViewport` may only be used to:
- Fill in when the plugin never fired (focus-in on an already-open IME).
- Bump the value UP when the plugin under-reports vs the *current* WebView overlay (Gboard toolbar/predictive strip). Bounded by `window.innerHeight - vv.height` — never by `baselineH - vv.height`.

A previous version used `vvTotalInset = baselineH - vv.height` as the primary signal whenever it exceeded 24px. `baselineH` is the monotonic-max of `innerHeight` (locked via `--visual-vh`). If baseline had ever been inflated — rotation history, OEM WebView shrink then restore, split-screen leftover — but the current WebView hadn't shrunk, `vvTotalInset` returned hundreds of px MORE than the actual keyboard. Chat pages subtract this from AppLayout height, so the chat shell collapsed to composer-only and left a huge blank strip between the composer and the physical keyboard. Reported by users tapping Reply on Android (Damian, 2026-07-10).

`useNativeKeyboardHeight` MUST stay a thin platform switch — do NOT layer another vvShrink/baseline pass on top.

`useNativeKeyboardBottomInset` (for fixed-position composers) is separate: it computes the *remaining* overlay after any OEM WebView resize.

Symptom of the bug: composer floating at the top of the visible area with 300-500px of blank background between it and the keyboard, or floating mid-screen.

**Why:** `baselineH` is intentionally monotonic-max to protect AppLayout from transient WebView shrinks (see mem://technical/android-visual-vh-lock). That same property makes it a bad denominator for keyboard-height inference. Always trust the plugin; use `layoutH - vv.height` as an upper bound.
