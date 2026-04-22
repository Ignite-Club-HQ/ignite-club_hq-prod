# iOS Fullscreen Image Pinch-and-Zoom Regression Checklist

Run this checklist on a **physical iOS device** (not the simulator) after any
change touching:

- `src/components/chat/FullscreenImageViewer.tsx`
- `src/hooks/usePinchZoom.ts`
- Any chat message row / bubble that wraps an image (gesture handlers,
  swipe-to-reply, long-press menus, `onPointerDown`/`onTouchStart` listeners)
- `useIOSScrollLock`, status bar control, or any code that calls
  `e.preventDefault()` on touch events globally
- App-level providers that mount above chat (modals, drawers, route
  transitions)

The simulator's two-finger pinch (Option-drag) does NOT reproduce the real
Safari/WKWebView gesture-arbitration behavior. Always validate on hardware.

---

## Setup

- [ ] Build a release-mode native iOS app (`npm run build` → `npx cap sync ios`
      → run from Xcode on a real device). Dev-server hot-reload sometimes
      masks gesture bugs because of overlays.
- [ ] Test on at least one **iPhone with a notch/Dynamic Island** (iPhone 12+)
      AND one **iPad** if the app supports tablet.
- [ ] Test in both **light and dark mode** (status bar transitions can
      interfere with touch events on first open).
- [ ] Sign in as a user who is a member of a chat with image messages.

---

## Core pinch-zoom behavior

Open a fullscreen image from a chat message and verify:

- [ ] **Two-finger pinch out** smoothly scales the image up to the max zoom
      (4×). No stutter, no snap-back mid-gesture.
- [ ] **Two-finger pinch in** smoothly scales down. Below ~1.05× the image
      snaps back to 1× centered.
- [ ] **Pan while zoomed** (one finger drag at scale > 1) moves the image
      smoothly within the viewport bounds.
- [ ] **Double-tap** at 1× zooms in to ~2× centered on the tap point.
- [ ] **Double-tap** while zoomed snaps back to 1× centered with the
      easing animation (no jump).
- [ ] **Single tap** at 1× closes the viewer.
- [ ] **Single tap** while zoomed does NOT close the viewer.

---

## Gesture-competition regression scenarios

These are the scenarios that broke in past regressions. The viewer is
portalled to `document.body` and stops touch propagation specifically to
prevent these. Re-verify each one:

- [ ] **Pinch on an image inside a chat bubble** does NOT trigger
      swipe-to-reply on the underlying chat row.
- [ ] **Pinch** does NOT trigger the long-press context menu on the chat
      bubble (no haptic feedback, no menu sheet).
- [ ] **Pinch** does NOT highlight or select text in the message bubble
      behind the viewer.
- [ ] Lifting **one finger before the other** during a pinch does NOT cause
      the zoom to immediately snap back. The image holds its scale until
      both fingers leave the screen.
- [ ] **Three-finger** touch (e.g., accidental palm) does NOT trigger
      a synthetic `dblclick` zoom after the fingers lift. There's a
      `MULTI_FINGER_SUPPRESS_MS` window — verify it works.
- [ ] **Edge-of-screen pinch** (fingers landing within ~20px of the left or
      right edge) does NOT trigger iOS interactive-pop-gesture or browser
      back-swipe.
- [ ] **Pinching across the safe-area inset** (top notch / bottom home
      indicator) still works; gesture is not clipped.

---

## Viewer chrome & overlays

- [ ] **Close (X) button** is tappable and closes the viewer (does not
      consume a pinch that started near it).
- [ ] **Download button** is tappable and downloads the image with a
      friendly filename (e.g. `ignite-photo-YYYY-MM-DD.jpg`) — the
      Supabase URL/host is NOT shown to the user.
- [ ] **Report** and **Block user** buttons (when shown) are tappable
      and open their respective sheets without interfering with pinch.
- [ ] **Status bar** style flips correctly when the viewer opens (light
      icons over the dark backdrop) and restores when it closes.
- [ ] Body scroll is locked while the viewer is open — no rubber-banding,
      no underlying chat scroll.

---

## Lifecycle & sync

- [ ] Opening the viewer, pinching, closing, and re-opening the SAME image
      works repeatedly without the second pinch being unresponsive.
- [ ] Opening the viewer, pinching, then **rotating the device** (portrait ↔
      landscape) keeps the gesture responsive after rotation.
- [ ] Backgrounding the app mid-pinch (swipe up to home / lock screen)
      and returning leaves the viewer in a sane state (either still open
      at 1× or closed) — no stuck pinch state, no frozen image.
- [ ] After a pinch session, scrolling the chat list resumes normally with
      no residual touch-event capture.

---

## Automated coverage

Before shipping, also run the automated regression suite locally — it
exercises the gesture wiring in jsdom and catches most propagation /
listener-passivity regressions:

```bash
npx vitest run src/components/chat/FullscreenImageViewer
npx vitest run src/hooks/usePinchZoom
```

Key files:

- `FullscreenImageViewer.ios.test.tsx` — passive-listener contract on
  `touchstart/move/end/cancel` and `touch-action: none`.
- `FullscreenImageViewer.chatancestor.test.tsx` — viewer is portalled out
  of the chat bubble; ancestor swipe / long-press / pointerDown handlers
  do NOT see the viewer's touch events.
- `FullscreenImageViewer.staggered-pinch.test.tsx` — staggered finger
  lifts don't snap back.
- `FullscreenImageViewer.threefinger.test.tsx` — multi-finger touches
  don't trigger synthetic double-tap zoom.
- `usePinchZoom.rotation.test.tsx` — rotation mid-gesture doesn't poison
  pinch state.

---

## When to re-run this checklist

- Any PR that touches the files listed at the top of this doc.
- Any Capacitor or `@capacitor/*` plugin upgrade.
- Any iOS major version upgrade (test on the new OS as soon as it ships).
- Any change to `useIOSScrollLock`, `applyStatusBarForViewer`, or the
  global app layout / providers above the chat route.
