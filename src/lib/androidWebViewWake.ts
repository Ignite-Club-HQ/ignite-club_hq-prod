import { Capacitor } from "@capacitor/core";

/**
 * Android WebView (Chromium under Capacitor) pauses its compositor and
 * throttles RAF / setTimeout when the app is backgrounded. On resume the
 * view often stays frozen on the last painted frame (or blank if Suspense
 * fallbacks were mid-flight) until the user taps — the touch event ticks
 * the JS loop and forces a paint.
 *
 * This helper subscribes to `appStateChange isActive=true` and forces:
 *   1. A microtask + rAF + setTimeout cascade so any pending React work flushes
 *   2. A `resize` event so layout/visualViewport hooks re-evaluate
 *   3. A no-op CSS transform toggle on <html> to invalidate the compositor
 *      layer and trigger a repaint
 *
 * Safe no-op on web / iOS.
 */
export function setupAndroidWebViewWake() {
  if (!Capacitor.isNativePlatform()) return;
  if (Capacitor.getPlatform() !== "android") return;

  let removed = false;
  void (async () => {
    try {
      const { App } = await import("@capacitor/app");
      const handle = await App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) return;
        kick();
      });
      if (removed) void handle.remove();
    } catch {
      /* ignore */
    }
  })();

  const kick = () => {
    // Force compositor invalidation: toggle a transform that costs nothing
    // visually but flips the layer's paint flag.
    try {
      const html = document.documentElement;
      const prev = html.style.transform;
      html.style.transform = "translateZ(0)";
      // Force a reflow read.
      void html.offsetHeight;
      requestAnimationFrame(() => {
        html.style.transform = prev;
        // Nudge any layout-dependent hooks.
        try { window.dispatchEvent(new Event("resize")); } catch { /* ignore */ }
      });
    } catch {
      /* ignore */
    }
    // Tick the loop a few times across the resume window so deferred timers
    // and Suspense fallbacks finish hydrating without needing a user tap.
    setTimeout(() => {
      try { window.dispatchEvent(new Event("resize")); } catch { /* ignore */ }
    }, 120);
    setTimeout(() => {
      try { window.dispatchEvent(new Event("resize")); } catch { /* ignore */ }
    }, 600);
  };

  return () => {
    removed = true;
  };
}
