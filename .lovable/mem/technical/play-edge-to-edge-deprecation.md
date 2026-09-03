---
name: Play edge-to-edge deprecation warning
description: Play Console "deprecated APIs for edge-to-edge" warning comes from Capacitor StatusBar + Material internals, not our code — do not chase it
type: constraint
---
Play Console shows a recommended (non-blocking) action: `Window.get/setStatusBarColor`,
`get/setNavigationBarColor` deprecated in Android 15.

Sources are upstream, not app code:
- `com.capacitorjs.plugins.statusbar.StatusBar.*ColorDeprecated` — inside `@capacitor/status-bar`
- `com.google.android.material.bottomsheet.BottomSheetDialog.onCreate` / `material.internal.Edge*`

As of Sep 2026 we are on the latest Capacitor 8 line (`@capacitor/status-bar` 8.0.3,
core 8.5.x); the plugin still calls the deprecated APIs internally, so upgrading does
NOT clear the warning. Play detects the calls statically in the APK, so removing our
`StatusBar.setBackgroundColor` calls would not clear it either.

**Do not** rip `setBackgroundColor` / `setOverlaysWebView(false)` out of
`src/lib/statusBarControl.ts` to chase this — that would regress the Samsung One UI
overlay race handling and the light/dark header colouring for zero Play benefit.

Action: ignore until Capacitor ships a `WindowInsetsController`-based StatusBar plugin,
then upgrade normally.
