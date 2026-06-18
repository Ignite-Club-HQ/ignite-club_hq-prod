import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { PITCH_BOARD_OPEN_KEY, PITCH_BOARD_OPEN_PATH_KEY } from "./types";
import { clearPitchBoardOpenFlag } from "./pitchBoardOpenFlag";

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
  // Restore is only allowed inside a short window after a true cold-start
  // or resume signal (mount, appStateChange isActive, visibilitychange,
  // pageshow). Outside that window, ordinary in-app navigation (e.g. user
  // taps Home in the bottom nav from /messages → "/") must NOT trigger a
  // restore — otherwise the pitch board re-opens unexpectedly whenever the
  // user lands on a neutral route after closing it earlier.
  const restoreWindowUntilRef = useRef(0);
  const openRestoreWindow = (ms = 6000) => {
    restoreWindowUntilRef.current = Math.max(
      restoreWindowUntilRef.current,
      Date.now() + ms,
    );
  };

  // Stable restore fn — reads current location via ref so it's safe across
  // listeners without forcing re-binding.
  const attemptRestoreRef = useRef<() => void>(() => {});
  attemptRestoreRef.current = () => {
    // Outside an explicit cold-start/resume window — do nothing. This is the
    // guard that prevents bottom-nav Home (or any in-app nav back to "/")
    // from re-opening the pitch board.
    if (Date.now() > restoreWindowUntilRef.current) return;
    // If PitchBoard is already mounted in this JS context, nothing to do —
    // avoid yanking the URL and forcing an unmount/remount loop.
    if ((window as any).__pitchBoardMounted === true) return;

    // Suppress warm-resume restores when the board was never opened in this
    // JS session — the persisted PITCH_BOARD_OPEN_KEY is stale (left over
    // from a previous run or a never-cleared crash path). Cold starts get
    // an 8s grace window so the original kill-and-restore use case still
    // works (iOS WKWebView eviction on long lock).
    const wasMountedThisSession =
      (window as any).__pitchBoardMountedThisSession === true;
    const isColdStart = performance.now() < 8000;
    if (!wasMountedThisSession && !isColdStart) {
      // Self-heal: clear the stale flag so we don't keep re-checking.
      clearPitchBoardOpenFlag();
      return;
    }

    try {
      if (localStorage.getItem(PITCH_BOARD_OPEN_KEY) !== "true") return;
      const storedPath = localStorage.getItem(PITCH_BOARD_OPEN_PATH_KEY);
      if (!storedPath) return;

      const loc = locationRef.current;
      const [path, query = ""] = storedPath.split("?");

      // Modal-on-home case: storedPath === "/"; nothing for us to do —
      // HomePage runs its own cold-start restore that re-opens the modal.
      if (path === "/" || path === "/home") return;

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

    // Cold start counts as a restore opportunity.
    openRestoreWindow();

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
              openRestoreWindow();
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
      if (document.visibilityState === "visible") {
        openRestoreWindow();
        attempt();
      }
    };
    // pageshow fires after WebView bfcache restore (iOS Safari/WKWebView).
    const onPageShow = () => {
      openRestoreWindow();
      attempt();
    };
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

  // Track previous pathname so we can detect explicit user navigation AWAY
  // from the stored pitch-board path. If, during an open restore window
  // (e.g. just after phone unlock), the user taps Home in the bottom nav
  // from the board's route to "/", that's an intentional close — shut the
  // window and clear the persisted flag so we don't bounce them back into
  // the board on the next attempt.
  const prevPathRef = useRef(location.pathname);
  useEffect(() => {
    const prev = prevPathRef.current;
    const next = location.pathname;
    prevPathRef.current = next;

    try {
      const storedPath = (
        localStorage.getItem(PITCH_BOARD_OPEN_PATH_KEY) || ""
      ).split("?")[0];
      const isNeutral = next === "/" || next === "/home";
      if (
        storedPath &&
        prev === storedPath &&
        isNeutral &&
        prev !== next
      ) {
        // User left the pitch-board route to a neutral page — treat as
        // explicit close. Cancel any in-flight restore window.
        restoreWindowUntilRef.current = 0;
        clearPitchBoardOpenFlag();
        return;
      }
    } catch {
      /* ignore */
    }

    attemptRestoreRef.current();
  }, [location.pathname]);

  return null;
}

