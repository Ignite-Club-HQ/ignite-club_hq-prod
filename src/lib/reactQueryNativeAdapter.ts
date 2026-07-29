import { onlineManager, focusManager, type QueryClient } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import { abortAllInFlightRestGets } from '@/lib/supabaseAuthRetry';

/**
 * Configures React Query's onlineManager and focusManager for Capacitor
 * native environments where browser events don't fire reliably.
 *
 * Uses @capacitor/network for connectivity hints and @capacitor/app for
 * foreground/background state. Because iOS Low Power Mode and Android
 * Battery Saver/Doze can deliver stale `connected: false` callbacks and
 * then suppress further updates for minutes, we also run a lightweight
 * HEAD probe against Supabase (with exponential backoff, foreground-only)
 * to recover from a stuck-offline state, and re-probe on every app resume.
 *
 * When `queryClient` is provided, we ALSO actively refetch errored queries
 * on every offline→online transition and on every app resume. This is the
 * recovery path for Messages/Schedule/Media on Android: when a query has
 * already errored out (offlineFirst networkMode), React Query's built-in
 * `refetchOnReconnect` only refires the queryFn for queries with status
 * `success` — errored queries stay errored until something invalidates
 * them. We explicitly invalidate so blank pages recover without a relaunch.
 */
export function setupReactQueryNativeAdapter(queryClient?: QueryClient) {
  if (!Capacitor.isNativePlatform()) return;

  // Expose a nudge so `supabaseAuthRetry.ts` can trip recovery whenever a
  // Supabase fetch fails with a network-shaped error (TypeError / AbortError
  // from our own 25s timeout). Android WebView frequently does NOT fire the
  // `networkStatusChange` callback on brief carrier drops, so relying on the
  // OS event alone leaves pages (Media, Schedule, AppHeader club theme)
  // stuck on the failed query even after connectivity returns. This gives us
  // a second recovery trigger driven by observed request failures.
  try {
    (window as any).__igniteNudgeNetworkCheck = (reason?: string) => {
      // Cancel any current backoff and probe right away. If the probe
      // succeeds it will flip online + kick errored queries. If we're
      // already online, just kick errored queries directly so a hung page
      // (that errored during the drop) refetches now.
      if (onlineManager.isOnline()) {
        recoverErroredQueries(reason || 'fetch-failure-nudge');
      } else {
        probeDelay = 500;
        clearProbe();
        runProbe();
      }
    };
  } catch { /* noop */ }

  const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;

  let probeTimer: ReturnType<typeof setTimeout> | null = null;
  let probeDelay = 1000; // start at ~1s, cap at 60s
  let isForeground = true;
  let probing = false;

  const clearProbe = () => {
    if (probeTimer) {
      clearTimeout(probeTimer);
      probeTimer = null;
    }
    probeDelay = 1000;
  };

  const runProbe = async () => {
    if (probing) return;
    if (!supabaseUrl) return;
    if (!isForeground) return;
    if (onlineManager.isOnline()) {
      clearProbe();
      return;
    }
    probing = true;
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 4000);
      // Hit Supabase root; any 2xx/3xx/4xx response means the network works.
      const res = await fetch(`${supabaseUrl}/auth/v1/health`, {
        method: 'GET',
        cache: 'no-store',
        signal: ctrl.signal,
      }).catch(() => null);
      clearTimeout(timeout);
      if (res) {
        onlineManager.setOnline(true);
        clearProbe();
        recoverErroredQueries('probe-recovered');
        return;
      }
    } finally {
      probing = false;
    }
    // Still offline — schedule next probe with backoff (cap 60s).
    probeDelay = Math.min(probeDelay * 2, 60000);
    if (isForeground) {
      probeTimer = setTimeout(runProbe, probeDelay);
    }
  };

  // Refetch any query that a mounted component is observing, plus anything
  // stuck in error / paused / hung-pending state. Built-in
  // `refetchOnReconnect: "always"` only refires queries with status
  // `success`; errored/paused queries (offlineFirst + network drop) stay
  // dead until something explicitly invalidates them, and success queries
  // whose fetch never resolved (mid-flight during the drop) can sit forever
  // in `pending/fetching` inside the WebView. On reconnect/resume we
  // therefore hit BOTH surfaces:
  //   1. every active (observed) query → refetch — recovers Messages,
  //      Schedule, Media, reward points, sponsor/ad tile, etc.
  //   2. every errored/paused/idle-non-success query → invalidate — recovers
  //      inactive-but-cached queries the next time they mount.
  let lastRecoveryAt = 0;
  // When the app went to background. Used to decide whether in-flight REST
  // GETs are worth keeping on resume (see LONG_BACKGROUND_MS).
  let backgroundedAt = 0;
  const LONG_BACKGROUND_MS = 20_000;

  // Requests that were in flight when Android suspended the WebView are
  // almost always sitting on a dead socket, and their abort timers were
  // frozen — so they never fail, never resolve, and hold connection slots.
  // Release them BEFORE the recovery refetch, otherwise the refetch queues
  // behind zombies and the screen stays on skeletons until a force-quit.
  const abortZombieRequests = (reason: string) => {
    try {
      const n = abortAllInFlightRestGets(reason);
      if (n > 0) console.log(`[NativeAdapter] aborted ${n} in-flight REST GET(s) on ${reason}`);
    } catch { /* noop */ }
  };

  const recoverErroredQueries = (reason: string) => {
    if (!queryClient) return;
    const now = Date.now();
    if (now - lastRecoveryAt < 2000) return; // throttle bursty triggers
    lastRecoveryAt = now;
    try {
      // 1. Refetch every actively-observed query. This is the sledgehammer
      //    that unsticks Messages/Schedule/Media/rewards/sponsor tiles on
      //    reconnect. `type: 'active'` scopes it to queries with mounted
      //    observers so we don't stampede the DB with hundreds of refetches.
      //
      //    IMPORTANT: this is DRIPPED, not fired in one tick. The Inbox alone
      //    mounts ~25-30 active queries; refetching them simultaneously
      //    saturates Android WebView's ~6-connection-per-origin pool and
      //    floods the main thread with response/cache-write work at exactly
      //    the moment the user taps a thread — the tap appears to do nothing
      //    and the UI stalls. Batches of 6, 120ms apart, keeps the pool busy
      //    but never starves input handling.
      try {
        const active = queryClient.getQueryCache().findAll({ type: 'active' });
        const BATCH = 6;
        for (let i = 0; i < active.length; i += BATCH) {
          const slice = active.slice(i, i + BATCH);
          const delay = (i / BATCH) * 120;
          setTimeout(() => {
            slice.forEach((q) => {
              try {
                queryClient.refetchQueries({ queryKey: q.queryKey, exact: true });
              } catch { /* noop */ }
            });
          }, delay);
        }
      } catch { /* noop */ }


      // 2. Also invalidate errored/paused/idle-non-success queries so they
      //    come back to life the next time their component mounts.
      const cache = queryClient.getQueryCache();
      const stuck = cache.getAll().filter((q) => {
        const s = q.state;
        return (
          s.status === 'error' ||
          (s.fetchStatus === 'idle' && s.status !== 'success') ||
          s.fetchStatus === 'paused'
        );
      });
      if (stuck.length > 0) {
        console.log(`[NativeAdapter] Recovering ${stuck.length} stuck queries (${reason})`);
        stuck.forEach((q) => {
          try {
            queryClient.invalidateQueries({ queryKey: q.queryKey, exact: true });
          } catch { /* noop */ }
        });
      }
      // Kick critical theme/club queries regardless of state — they may be
      // disabled (user=null) during a transient SIGNED_OUT and miss the
      // reconnect window otherwise.
      try {
        queryClient.invalidateQueries({ queryKey: ['club-themes'] });
        queryClient.invalidateQueries({ queryKey: ['user-clubs-for-switcher'] });
        queryClient.invalidateQueries({ queryKey: ['all-user-clubs-for-theme-v2'] });
      } catch { /* noop */ }
    } catch (e) {
      console.warn('[NativeAdapter] recoverErroredQueries failed:', e);
    }
  };


  const scheduleProbeIfOffline = () => {
    if (onlineManager.isOnline()) {
      clearProbe();
      return;
    }
    if (!isForeground) return;
    if (probeTimer) return;
    probeTimer = setTimeout(runProbe, probeDelay);
  };

  // --- Online Manager via Capacitor Network plugin ---
  onlineManager.setEventListener((setOnline) => {
    const listenerPromise = import('@capacitor/network').then(({ Network }) => {
      Network.getStatus().then((status) => {
        setOnline(status.connected);
        if (!status.connected) scheduleProbeIfOffline();
      });
      return Network.addListener('networkStatusChange', (status) => {
        const wasOnline = onlineManager.isOnline();
        setOnline(status.connected);
        if (status.connected) {
          clearProbe();
          if (!wasOnline) recoverErroredQueries('network-reconnect');
        } else {
          scheduleProbeIfOffline();
        }
      });
    });

    return () => {
      listenerPromise.then((listener) => listener.remove());
      clearProbe();
    };
  });

  // --- Focus Manager via Capacitor App plugin ---
  import('@capacitor/app').then(({ App }) => {
    focusManager.setEventListener((handleFocus) => {
      const listenerPromise = App.addListener('appStateChange', ({ isActive }) => {
        isForeground = isActive;
        if (isActive) {
          const hiddenFor = backgroundedAt ? Date.now() - backgroundedAt : 0;
          backgroundedAt = 0;
          // Abort-then-refetch. Must happen before handleFocus/recovery so the
          // connection pool is free when the recovery drip starts.
          if (hiddenFor >= LONG_BACKGROUND_MS) abortZombieRequests('app-resume');
          handleFocus();
          // On resume, re-check connectivity rather than trusting the cached
          // value (Low Power Mode / Doze can have left it stale).
          import('@capacitor/network').then(({ Network }) => {
            Network.getStatus().then((status) => {
              if (status.connected) {
                onlineManager.setOnline(true);
                clearProbe();
                // Kick any queries that errored while we were backgrounded.
                // refetchOnWindowFocus is `false` globally, so the focusManager
                // path alone won't refire them.
                recoverErroredQueries('app-resume');
              } else {
                // OS says offline — but verify with a probe before trusting it.
                probeDelay = 1000;
                runProbe();
              }
            });
          });
        } else {
          backgroundedAt = Date.now();
          clearProbe();
        }
      });

      return () => {
        listenerPromise.then((listener) => listener.remove());
      };
    });
  });

  // Belt-and-braces: Android WebView sometimes delivers `visibilitychange`
  // without a matching `appStateChange`. Track hidden time here too so the
  // zombie abort still runs on those resumes. The recovery refetch itself is
  // left to the appStateChange path / nudge so we don't double-fire it.
  try {
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      const hiddenFor = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (hiddenFor >= LONG_BACKGROUND_MS) {
        abortZombieRequests('visibility-resume');
        recoverErroredQueries('visibility-resume');
      }
    });
  } catch { /* noop */ }
}
