import { onlineManager, focusManager, type QueryClient } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';

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

  const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;

  let probeTimer: ReturnType<typeof setTimeout> | null = null;
  let probeDelay = 5000; // start at 5s, cap at 60s
  let isForeground = true;
  let probing = false;

  const clearProbe = () => {
    if (probeTimer) {
      clearTimeout(probeTimer);
      probeTimer = null;
    }
    probeDelay = 5000;
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

  // Refetch any active queries currently stuck in error state. Built-in
  // `refetchOnReconnect: "always"` only refires queries with status
  // `success`; errored queries (offlineFirst + network drop = instant
  // error) require an explicit invalidate to come back to life.
  let lastRecoveryAt = 0;
  const recoverErroredQueries = (reason: string) => {
    if (!queryClient) return;
    const now = Date.now();
    if (now - lastRecoveryAt < 2000) return; // throttle bursty triggers
    lastRecoveryAt = now;
    try {
      const cache = queryClient.getQueryCache();
      const errored = cache.getAll().filter((q) => {
        const s = q.state;
        return (
          s.status === 'error' ||
          (s.fetchStatus === 'idle' && s.status !== 'success') ||
          // Paused queries (networkMode-driven) — kick them too.
          s.fetchStatus === 'paused'
        );
      });
      if (errored.length === 0) return;
      console.log(`[NativeAdapter] Recovering ${errored.length} errored queries (${reason})`);
      errored.forEach((q) => {
        try {
          queryClient.invalidateQueries({ queryKey: q.queryKey, exact: true });
        } catch {
          /* noop */
        }
      });
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
          handleFocus();
          // On resume, re-check connectivity rather than trusting the cached
          // value (Low Power Mode / Doze can have left it stale).
          import('@capacitor/network').then(({ Network }) => {
            Network.getStatus().then((status) => {
              if (status.connected) {
                onlineManager.setOnline(true);
                clearProbe();
              } else {
                // OS says offline — but verify with a probe before trusting it.
                probeDelay = 5000;
                runProbe();
              }
            });
          });
        } else {
          clearProbe();
        }
      });

      return () => {
        listenerPromise.then((listener) => listener.remove());
      };
    });
  });
}
