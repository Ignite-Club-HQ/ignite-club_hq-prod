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

  useEffect(() => {
    let cancelled = false;

    const attemptRestore = () => {
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
        // only bail when we're on an unrelated route the user navigated to
        // intentionally — never yank them out of that.
        const onNeutral = loc.pathname === "/" || loc.pathname === "/home";
        const onStored = loc.pathname === path;
        if (!onNeutral && !onStored) return;

        // Already mid-restore (param present and on the right path) → nothing to do.
        const currentParams = new URLSearchParams(loc.search);
        if (onStored && currentParams.get("openPitchBoard") === "1") return;

        const params = new URLSearchParams(query);
        params.set("openPitchBoard", "1");
        navigate(`${path}?${params.toString()}`, { replace: true });
      } catch {
        /* ignore */
      }
    };

    // Cold-start: try once immediately, then again on next frame in case the
    // router/auth layer just finished hydrating and we lost a race.
    attemptRestore();
    const raf = requestAnimationFrame(() => {
      if (!cancelled) attemptRestore();
    });

    // Warm resume on native: phone unlock often delivers appStateChange
    // before any other lifecycle signal.
    let removeListener: (() => void) | undefined;
    if (Capacitor.isNativePlatform()) {
      void (async () => {
        try {
          const { App } = await import("@capacitor/app");
          const handle = await App.addListener("appStateChange", ({ isActive }) => {
            if (isActive) attemptRestore();
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
      if (document.visibilityState === "visible") attemptRestore();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      removeListener?.();
    };
    // Only set up once for the app lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
