import { onlineManager, type QueryClient } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";

/**
 * Web-only reconnect / resume invalidator for a scoped whitelist of
 * user-visible query keys.
 *
 * Native apps get the equivalent (and broader) behaviour from
 * `reactQueryNativeAdapter.ts`. On the web, iOS Safari and iframed
 * previews frequently miss the `offline → online` transition, so
 * `refetchOnReconnect: "always"` alone is not enough — pages like Media
 * end up stuck on skeleton loaders after the network returns.
 *
 * We intentionally invalidate only a small whitelist (not everything)
 * so reconnect does not stampede the DB with dozens of parallel refetches.
 * Keys listed here are the ones whose hangs users notice most:
 *   - `photos` — the Media feed infinite query
 *   - `latest-photos-scroll` — homepage strip
 *   - `has-pro-access` — Pro gate for Media/Schedule
 *   - `club-pro-access` — per-club Pro resolution
 */
const RECOVERABLE_KEYS = [
  "photos",
  "latest-photos-scroll",
  "team-latest-photos",
  "has-pro-access",
  "club-pro-access",
] as const;

let installed = false;

export function installWebReconnectInvalidator(queryClient: QueryClient) {
  if (installed) return;
  if (Capacitor.isNativePlatform()) return; // native adapter covers this
  if (typeof window === "undefined") return;

  installed = true;

  let lastRunAt = 0;
  const THROTTLE_MS = 2000;

  const kick = (reason: string) => {
    const now = Date.now();
    if (now - lastRunAt < THROTTLE_MS) return;
    lastRunAt = now;
    try {
      for (const key of RECOVERABLE_KEYS) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      if (import.meta.env.DEV) {
        console.log(`[WebReconnect] invalidated ${RECOVERABLE_KEYS.length} keys (${reason})`);
      }
    } catch {
      /* ignore */
    }
  };

  // Fires whenever React Query flips online state (also covers native events
  // routed through onlineManager if any manual toggle happens on web).
  const unsubscribe = onlineManager.subscribe(() => {
    if (onlineManager.isOnline()) kick("online-manager");
  });

  const onBrowserOnline = () => kick("window-online");
  const onVisibility = () => {
    if (document.visibilityState === "visible" && navigator.onLine !== false) {
      kick("visibility");
    }
  };

  window.addEventListener("online", onBrowserOnline);
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    unsubscribe();
    window.removeEventListener("online", onBrowserOnline);
    document.removeEventListener("visibilitychange", onVisibility);
    installed = false;
  };
}
