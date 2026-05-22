import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { PITCH_BOARD_OPEN_KEY, PITCH_BOARD_OPEN_PATH_KEY } from "./types";

/**
 * Restores the pitch board after a WebView cold-start (iOS lock/unlock kills
 * the WebView, Android low-memory kills the process). We persist the open
 * flag + last route while the board is mounted; on cold-start the app loads
 * back at "/" and this component navigates to the stored event route with
 * ?openPitchBoard=1 so the board auto-opens again.
 *
 * Triggers:
 *  - Component mount (cold start).
 *  - Native `appStateChange isActive=true` (warm resume — covers cases where
 *    the WebView survived but the in-memory React state was lost).
 *
 * We never redirect AWAY from a non-neutral route the user is on — only from
 * the landing page — so an intentional navigation isn't yanked back.
 */
export default function PitchBoardResumeRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location);
  locationRef.current = location;
  const lastAttemptRef = useRef(0);

  // Stable restore fn — reads current location via ref so it's safe across
  // listeners without forcing re-binding.
  const attemptRestoreRef = useRef<() => void>(() => {});
  attemptRestoreRef.current = () => {
    // If PitchBoard is already mounted in this JS context, nothing to do —
    // avoid yanking the URL and forcing an unmount/remount loop.
    if ((window as any).__pitchBoardMounted === true) return;
    try {
      if (localStorage.getItem(PITCH_BOARD_OPEN_KEY) !== "true") return;
      const storedPath = localStorage.getItem(PITCH_BOARD_OPEN_PATH_KEY);
      if (!storedPath) return;

      const loc = locationRef.current;
      const [path, query = ""] = storedPath.split("?");

      // Modal-on-home case: storedPath === "/"; nothing for us to do —
      // HomePage runs its own cold-start restore that re-opens the modal.
      if (path === "/" || path === "/home") return;

      // Allow restore from BOTH neutral landing routes (cold start back at
      // "/") AND from the stored path itself when React state was wiped but
      // the URL was preserved (warm WebView reload on iOS lock/unlock). We
      // also allow restore while still on /auth — auth completion will
      // bounce to "/" and the location-change effect below will retry.
      const onNeutral =
        loc.pathname === "/" || loc.pathname === "/home";
      const onStored = loc.pathname === path;
      if (!onNeutral && !onStored) return;

      // Already mid-restore (param present and on the right path) → nothing to do.
      const currentParams = new URLSearchParams(loc.search);
      if (onStored && currentParams.get("openPitchBoard") === "1") return;

      // Debounce — multiple triggers (mount + RAF + appStateChange + location
      // change) can fire in the same tick; coalesce to one navigate().
      const now = Date.now();
      if (now - lastAttemptRef.current < 250) return;
      lastAttemptRef.current = now;

      const params = new URLSearchParams(query);
      params.set("openPitchBoard", "1");
      navigate(`${path}?${params.toString()}`, { replace: true });
    } catch {
      /* ignore */
    }
  };

  // Mount-only: set up cold-start retries + native/web visibility listeners.
  useEffect(() => {
    let cancelled = false;
    const attempt = () => attemptRestoreRef.current();

    // Cold-start: try immediately, then with a generous retry ladder so we
    // catch the case where the URL is still /auth or the Suspense fallback
    // when the first attempt runs, and only resolves to "/" a few hundred
    // milliseconds later once the AuthProvider hydrates.
    const delays = [0, 250, 750, 1500, 3000, 5000];
    const timers = delays.map((d) =>
      window.setTimeout(() => {
        if (!cancelled) attempt();
      }, d)
    );

    // Warm resume on native: phone unlock often delivers appStateChange
    // before any other lifecycle signal.
    let removeListener: (() => void) | undefined;
    if (Capacitor.isNativePlatform()) {
      void (async () => {
        try {
          const { App } = await import("@capacitor/app");
          const handle = await App.addListener("appStateChange", ({ isActive }) => {
            if (isActive) {
              // Retry across the post-resume hydration window — Capacitor
              // sometimes restores the WebView to the start URL ("/") and
              // React needs a frame or two to finish bootstrap.
              attempt();
              window.setTimeout(attempt, 400);
              window.setTimeout(attempt, 1200);
            }
          });
          if (cancelled) {
            void handle.remove();
          } else {
            removeListener = () => {
              void handle.remove();
            };
          }
        } catch {
          /* native module unavailable — fine */
        }
      })();
    }

    // Web/PWA fallback: when the tab becomes visible again.
    const onVisibility = () => {
      if (document.visibilityState === "visible") attempt();
    };
    // pageshow fires after WebView bfcache restore (iOS Safari/WKWebView).
    const onPageShow = () => attempt();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      removeListener?.();
    };
  }, []);

  // Re-attempt whenever the route changes — covers the cold-start race where
  // the first attempts run while still on /auth and the user is then routed
  // to "/" once auth resolves (no visibility/appState event fires for that).
  useEffect(() => {
    attemptRestoreRef.current();
  }, [location.pathname]);

  return null;
}

