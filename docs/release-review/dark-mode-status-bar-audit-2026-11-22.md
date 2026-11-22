# Dark-mode status bar audit and repair

Date: 22 November 2026. Scope: DEV source only; no production publication, native release, database changes or live data writes.

## Confirmed causes

1. **Native light repaint between bridge calls.** Installed Capacitor Android `SystemBars.setStyle` sets the window decor background to `android:windowBackground`. All three generated Activity themes intentionally have a light startup background. The previous controller paints dark, calls SystemBars, then paints dark again. Those are separate asynchronous bridge/UI operations: correct final readback cannot prevent an intervening light frame. The same upstream reset runs on configuration changes and viewer transitions. Light mode masks the defect because both backgrounds are light.
2. **Navigation forces unnecessary reconfiguration.** `StatusBarManager` called `refreshStatusBar` on every pathname change, bypassing the controller's theme deduplication and exposing the native reset repeatedly.
3. **Queued theme reads can become stale.** Default requests captured the DOM theme before execution; multiple root mutations could queue light then dark even though the app was already dark when the queue ran.
4. **Unrelated class changes trigger native requests.** Accessibility/root classes also reach the observer; those are not theme transitions and should not disturb viewer chrome.

Three executable regressions failed before repair: forced navigation repaint, unrelated root class updates, and stale queued theme application.

## Repairs

- Shared Android build preparation removes only the exact reviewed upstream static-theme decor repaint. It leaves icon style setters, SystemBars cached styles, visibility, configuration callbacks, safe-area handling and keyboard behavior unchanged. Unknown upstream source fails preparation rather than receiving a broad patch. Both existing Android workflows already invoke this helper.
- Ordinary navigation requests use the serialized, deduplicated theme application. Viewer teardown and native resume still explicitly force recovery.
- Default theme requests read the DOM when their queue entry executes. Explicit requested themes remain explicit.
- The root class observer requests native changes only when dark-mode membership actually changes.
- Existing opaque browser canvas and nonfading dark pressed states remain intact; no global tap handlers or new polling were introduced.

## Verification

- Email mode: **28 passed, 0 failed**, six focused files.
- ICP mode: **28 passed, 0 failed**, same six focused files.
- Android scaffold/preparation: **5 passed**, including real installed Capacitor source, idempotent preparation, unexpected-upstream refusal and both Android workflow wiring.
- Regression coverage includes ten deduplicated dark requests, current-theme queue reads, forced resume, viewer-to-dark restoration, iOS isolation, browser no-op, unchanged safe-area ownership, keyboard dimensions and viewer gestures.
- Playwright: repeated actual sign-in tab presses on `/auth`, desktop 1280×1800 and phone-sized 412×915, in both themes. Dark root canvas stayed `rgb(13, 18, 16)`, pressed controls remained opaque, light feedback stayed at 0.7 opacity, and no page errors were observed. Screenshots inspected.
- Preview build log: latest checked entry reports **build OK**. Whitespace check passes.

## Remaining acceptance

Browser automation cannot display Android's real status bar. Android SDK/device access is unavailable; the native correction is verified as a narrow build-preparation transformation, not a compiled/device-tested release. A **new Android build is required** to include it: publishing the website alone cannot update an installed native dependency. On the updated phone, check repeated buttons/navigation, opening/closing photos, rotation, app background/resume and keyboard show/hide in both themes. Existing startup/splash colors are deliberately unchanged.

No full phone-flashing resolution or production release approval is claimed before that check.