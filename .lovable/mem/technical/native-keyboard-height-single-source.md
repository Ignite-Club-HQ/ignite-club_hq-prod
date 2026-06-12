---
name: Native keyboard height single source of truth
description: useNativeKeyboardHeight must NOT add a second vvShrink/baseline pass on top of useNativeAndroidKeyboardState
type: constraint
---
`useNativeAndroidKeyboardState` already does all keyboard-height reconciliation: raw-plugin → CSS px conversion, `visualViewport.height` cross-check, and 60%-of-innerHeight cap.

`useNativeKeyboardHeight` MUST simply pass that value through. Any second pass (subtracting `androidBaselineHeight - vv.height` again, applying another ceiling) double-processes the inset and produces inverted/over-corrected values that float the fixed-position chat composer mid-screen on Samsung/Xiaomi/OEM Gboard configs where the WebView partially shrinks despite `Keyboard.resize: 'none'`.

Symptom of the bug: composer rendered halfway up the screen with chat messages bleeding visibly below it and above the keyboard.

**Why:** Two stacked reconciliations of the same `vvShrink` quantity always cancel or invert. Only one place may reconcile.

**How to apply:** Keep the per-platform hooks (`useNativeAndroidKeyboardState`, `useNativeIOSKeyboardState`) as the single source of truth. `useNativeKeyboardHeight` is a thin platform-switch only.
