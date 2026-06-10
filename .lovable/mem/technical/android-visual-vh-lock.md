---
name: Android --visual-vh must be monotonic-max locked
description: Why --visual-vh on Android must never shrink, and the blank-gap bug it causes if it does
type: constraint
---
On Android, `StatusBarManager.setVisualVh()` writes `--visual-vh` from `window.innerHeight` because Capacitor's `Keyboard.resize: 'none'` is supposed to keep innerHeight constant when the IME opens. In reality, several real-world conditions DO shrink `window.innerHeight` mid-session despite that setting: configuration changes, WebView Chrome updates, split-screen / multi-window, Samsung One UI / Xiaomi MIUI keyboard handling, and system overlays like autofill/voice input.

If a shrunken `innerHeight` leaks into `--visual-vh`, AppLayout's root shrinks while `useChatViewportHeight` still subtracts the full native keyboard height — producing a large blank gap between the chat composer and the soft keyboard. Symptom: composer floats ~⅓ down the screen, big white area between composer and keyboard. Appears randomly mid-session, never on initial login.

**Rule:** `--visual-vh` on Android MUST be a monotonic max (`lockedAndroidVisualVh`). Only reset on `orientationchange`. `useChatViewportHeight` is the single source of truth for the keyboard inset; AppLayout's height must never shrink with the keyboard.
