import { onlineManager, type QueryClient } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";

/**
 * Web-only reconnect / resume recovery.
 *
 * Native apps get the equivalent (and broader) behaviour from
 * `reactQueryNativeAdapter.ts`. On the web, iOS Safari and iframed
 * previews frequently miss the `offline → online` transition, and
 * `refetchOnReconnect: "always"` only refires queries whose status is
 * `success` — queries that errored or got stuck mid-flight during the
 * drop stay dead until something explicitly kicks them.
 *
 * On any of {onlineManager online, `window.online`, tab visibility
 * returning to visible while `navigator.onLine`}, we:
 *   1. Refetch every actively-observed query (`type: 'active'`). This
 *      unsticks Messages/Schedule/Media/rewards/sponsor tiles regardless
 *      of the specific query keys they use.
 *   2. Invalidate any query stuck in error / paused / idle-non-success
 *      state so it recovers on next mount.
 *
 * Scoping to active queries prevents a reconnect stampede against the DB.
 */
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
      queryClient.refetchQueries({ type: "active" });
      const cache = queryClient.getQueryCache();
      const stuck = cache.getAll().filter((q) => {
        const s = q.state;
        return (
          s.status === "error" ||
          (s.fetchStatus === "idle" && s.status !== "success") ||
          s.fetchStatus === "paused"
        );
      });
      stuck.forEach((q) => {
        try {
          queryClient.invalidateQueries({ queryKey: q.queryKey, exact: true });
        } catch { /* ignore */ }
      });
      if (import.meta.env.DEV) {
        console.log(
          `[WebReconnect] refetched active + ${stuck.length} stuck (${reason})`,
        );
      }
    } catch {
      /* ignore */
    }
  };

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

