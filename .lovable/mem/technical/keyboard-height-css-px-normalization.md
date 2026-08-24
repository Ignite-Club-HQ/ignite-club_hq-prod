---
name: Capacitor keyboardHeight must be normalised to CSS px
description: Raw plugin keyboardHeight is device px on Android; any layout math using it directly over-pads/over-scrolls by ~dpr× leaving a huge blank gap above the keyboard
type: constraint
---
The Capacitor Keyboard plugin's `keyboardHeight` is **device pixels on Android** (points == CSS px on iOS). Any consumer that feeds it into layout math (padding-bottom, scroll overlap, inset calc) MUST pass it through `resolveKeyboardCssHeight()` (`src/lib/keyboardCssHeight.ts`) first.

**Why:** on a dpr 2.625 device a 300 CSS px keyboard is reported as ~787. Raw use produced:
- StatusBarManager's `keyboardDidShow` input-scroll handler over-scrolling the scroll container → huge blank gap between the focused input and the keyboard (reported on the Photos upload caption field, 2026-08-24).
- AuthPage/ResetPasswordPage `nativeKeyboardHeight` over-padding by up to ~160 px even with the 60% clamp.

`useNativeAndroidKeyboardState.computeHeight` already does this conversion internally and stays the ground truth for chat shells — do not refactor it; route NEW consumers through the shared helper. Heuristic: raw > 60% of window.innerHeight ⇒ device px ⇒ divide by DPR; always clamp result to 60% of window.
