---
name: MediaCommentSheet must use --visual-vh on native Android
description: Why fixed full-height sheets that add keyboard paddingBottom must use --visual-vh (locked) not --stable-vh on Android
type: constraint
---
`MediaCommentSheet` (and any other `position: fixed; inset:0` sheet that docks its composer via `paddingBottom = nativeKeyboardHeight`) MUST size its height with `--visual-vh` on native Android, NOT `--stable-vh`.

**Why:** `StatusBarManager.setStableVh()` is monotonic-max locked only for iOS (`lockedIOSStableVh`). On Android `--stable-vh = Math.max(visualViewport.height, innerHeight)` with NO lock, so on OEM WebViews that shrink `innerHeight` despite `Keyboard.resize:'none'` (Samsung One UI, Xiaomi MIUI, split-screen, post-config-change), `--stable-vh` drops by the keyboard height. The composer then ALSO adds `paddingBottom = keyboardInset`, double-subtracting the keyboard and floating the input a full keyboard-height above the actual IME — a large white gap.

`--visual-vh` IS monotonic-max locked on Android (`lockedAndroidVisualVh`), so it stays at the full window height and only the single `paddingBottom` subtraction applies. iOS keeps `--stable-vh` (locked there) so the fixed sheet extends under the IME and the single paddingBottom lifts the composer.
