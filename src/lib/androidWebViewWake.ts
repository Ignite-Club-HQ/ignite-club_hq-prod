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

  let kickScheduled = false;

  const kick = () => {
    // Coalesce overlapping resume signals (appStateChange + visibilitychange
    // + pageshow + focus all fire within the same tick on warm resume).
    // Without this gate, two kicks can race: kick #2 snapshots the
    // mid-flight "hidden" visibility from kick #1 and then "restores" the
    // page to hidden — leaving a black, unresponsive screen until cold start.
    if (kickScheduled) return;
    kickScheduled = true;

    try {
      const html = document.documentElement;
      const body = document.body;
      // Set inline 'hidden' then REMOVE the inline property in rAF.
      // Removing (vs restoring a captured snapshot) is reentrancy-safe:
      // any overlapping kicks converge to "no inline visibility" = visible.
      if (body) body.style.visibility = "hidden";
      html.style.transform = "translateZ(0)";
      void html.offsetHeight; // reflow
      requestAnimationFrame(() => {
        if (body) body.style.removeProperty("visibility");
        html.style.removeProperty("transform");
        try { window.scrollBy(0, 0); } catch { /* ignore */ }
        try { window.dispatchEvent(new Event("resize")); } catch { /* ignore */ }
        kickScheduled = false;
      });
    } catch {
      kickScheduled = false;
    }
    [60, 200, 600, 1500].forEach((d) => {
      setTimeout(() => {
        try { window.dispatchEvent(new Event("resize")); } catch { /* ignore */ }
      }, d);
    });
    // Second compositor invalidation later in the resume window — iOS in
    // particular sometimes needs a second nudge once WKWebView finishes
    // rehydrating the layer tree. Use removeProperty here too so an
    // overlapping kick can't strand a stale inline transform.
    setTimeout(() => {
      try {
        const html = document.documentElement;
        html.style.transform = "translateZ(0.0001px)";
        void html.offsetHeight;
        requestAnimationFrame(() => {
          html.style.removeProperty("transform");
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
