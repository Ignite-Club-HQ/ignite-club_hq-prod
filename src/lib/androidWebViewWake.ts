import { Capacitor } from "@capacitor/core";

/**
 * WebView resume repaint kick.
 *
 * Both Android Chromium WebView and iOS WKWebView throttle / suspend the
 * compositor when the app is backgrounded. On resume the view often stays
 * frozen on the last painted frame (or blank if a Suspense fallback was
 * mid-flight) until the user taps — the touch event ticks the JS loop and
 * forces a paint.
 *
 * We listen on every signal that can mark "app is visible again":
 *   - Capacitor `App.appStateChange` with isActive=true (native warm resume)
 *   - `document.visibilitychange` → visible
 *   - `window.pageshow` (bfcache restore)
 *   - `window.focus`
 *
 * For each, we run a kick cascade that:
 *   1. Toggles a compositor-invalidating CSS transform on <html>
 *   2. Forces a reflow read
 *   3. Nudges window by `scrollBy(0, 0)` to wake the scroll compositor
 *   4. Dispatches `resize` at 0 / 60 / 200 / 600 / 1500 ms so visualViewport
 *      and layout hooks re-evaluate and Suspense work finishes hydrating
 *
 * Safe no-op on web (still runs the visibility/pageshow handlers, which is
 * desirable for PWA installs).
 */
export function setupWebViewWake() {
  if (typeof window === "undefined") return () => {};

  const isNative = Capacitor.isNativePlatform();

  const kick = () => {
    try {
      const html = document.documentElement;
      const body = document.body;
      const prevTransform = html.style.transform;
      // Most reliable Android WebView repaint trigger: briefly hide the body
      // then restore it. This forces the compositor to discard its cached
      // surface and produce a fresh frame, which a transform toggle alone
      // does not always do after a long suspend.
      const prevVisibility = body?.style.visibility ?? "";
      if (body) body.style.visibility = "hidden";
      html.style.transform = "translateZ(0)";
      void html.offsetHeight; // reflow
      requestAnimationFrame(() => {
        if (body) body.style.visibility = prevVisibility;
        html.style.transform = prevTransform;
        try { window.scrollBy(0, 0); } catch { /* ignore */ }
        try { window.dispatchEvent(new Event("resize")); } catch { /* ignore */ }
      });
    } catch {
      /* ignore */
    }
    [60, 200, 600, 1500].forEach((d) => {
      setTimeout(() => {
        try { window.dispatchEvent(new Event("resize")); } catch { /* ignore */ }
      }, d);
    });
    // Second compositor invalidation later in the resume window — iOS in
    // particular sometimes needs a second nudge once WKWebView finishes
    // rehydrating the layer tree.
    setTimeout(() => {
      try {
        const html = document.documentElement;
        const prev = html.style.transform;
        html.style.transform = "translateZ(0.0001px)";
        void html.offsetHeight;
        requestAnimationFrame(() => {
          html.style.transform = prev;
        });
      } catch {
        /* ignore */
      }
    }, 350);
  };

  let removed = false;
  let removeNative: (() => void) | undefined;

  if (isNative) {
    void (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) kick();
        });
        if (removed) {
          void handle.remove();
        } else {
          removeNative = () => { void handle.remove(); };
        }
      } catch {
        /* ignore */
      }
    })();
  }

  const onVisibility = () => {
    if (document.visibilityState === "visible") kick();
  };
  const onPageShow = () => kick();
  const onFocus = () => kick();

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("focus", onFocus);

  return () => {
    removed = true;
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pageshow", onPageShow);
    window.removeEventListener("focus", onFocus);
    removeNative?.();
  };
}

// Back-compat alias — call sites still import the old name.
export const setupAndroidWebViewWake = setupWebViewWake;
