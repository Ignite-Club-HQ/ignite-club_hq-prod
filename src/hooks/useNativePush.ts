/**
 * React hook for managing native push notifications
 * 
 * Handles:
 * - Automatic initialization when user logs in
 * - Token refresh handling
 * - Notification listeners
 * - Cleanup on logout
 * - Processing pending notification navigation from cold start
 * 
 * IMPORTANT: This hook is designed to fail gracefully if Firebase/FCM is not configured.
 * The native app will NOT crash if google-services.json or GoogleService-Info.plist is missing,
 * but push notifications simply won't work.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  processPendingNotificationNavigation,
  isNotificationNavigationHandled,
  setNotificationNavigator,
  clearNotificationNavigator,
} from '@/lib/notificationLaunchHandler';

let capacitorAppModule: typeof import('@capacitor/app') | null = null;

async function loadCapacitorAppModule() {
  if (capacitorAppModule) return capacitorAppModule;

  try {
    capacitorAppModule = await import('@capacitor/app');
    return capacitorAppModule;
  } catch (err) {
    console.warn('[useNativePush] Failed to load Capacitor App module:', err);
    return null;
  }
}

// Lazy import everything to prevent crashes at module load time
let nativePushModule: typeof import('@/lib/nativePush') | null = null;
let moduleLoadAttempted = false;
let moduleLoadFailed = false;

async function loadNativePushModule() {
  if (moduleLoadAttempted) {
    return !moduleLoadFailed ? nativePushModule : null;
  }
  
  moduleLoadAttempted = true;
  
  try {
    nativePushModule = await import('@/lib/nativePush');
    return nativePushModule;
  } catch (err) {
    console.warn('[useNativePush] Failed to load nativePush module:', err);
    moduleLoadFailed = true;
    return null;
  }
}

interface UseNativePushOptions {
  enabled?: boolean;
}

// (Helpers for URL normalization moved to notificationLaunchHandler.ts —
// this hook no longer routes notification taps directly. BUG-1 consolidation.)


export function useNativePush(userId: string | undefined, options: UseNativePushOptions = {}) {
  const { enabled = true } = options;
  const navigate = useNavigate();
  const cleanupRef = useRef<(() => void) | null>(null);
  const initializedRef = useRef(false);
  const [isNative, setIsNative] = useState(false);
  const pendingNavProcessed = useRef(false);

  // Check if we're on native platform. The single Capacitor action listener
  // lives in notificationLaunchHandler.ts (installed at app start). Here we
  // only register a navigator so warm taps can navigate immediately, and
  // drain any URL stashed from a cold-start tap.
  useEffect(() => {
    const nav: (path: string) => void = (path) => navigate(path);

    loadNativePushModule().then(mod => {
      if (!mod) return;
      try {
        const native = mod.isNativePlatform();
        setIsNative(native);

        if (native) {
          setNotificationNavigator(nav);

          // Cold start: try to drain any URL already stashed by the launch handler.
          if (!pendingNavProcessed.current) {
            pendingNavProcessed.current = true;
            const wasProcessed = processPendingNotificationNavigation(navigate);
            if (wasProcessed) {
              console.log('[useNativePush] Processed pending notification navigation');
            } else {
              // Retry with increasing delays for cold start timing. Bail as soon
              // as the URL is consumed or another handler has marked it handled.
              const retryDelays = [500, 1500, 3000, 5000, 8000, 12000];
              retryDelays.forEach(delay => {
                setTimeout(() => {
                  if (isNotificationNavigationHandled()) return;
                  const wasProcessedRetry = processPendingNotificationNavigation(navigate);
                  if (wasProcessedRetry) {
                    console.log(`[useNativePush] Processed pending notification navigation (retry ${delay}ms)`);
                  }
                }, delay);
              });
            }
          }
        }
      } catch {
        setIsNative(false);
      }
    });

    return () => {
      clearNotificationNavigator(nav);
    };
  }, [navigate]);


  // Save refreshed token to database
  const handleTokenRefresh = useCallback(async (token: string) => {
    if (!userId) return;
    
    console.log('[useNativePush] Token refreshed, saving...');
    try {
      const mod = await loadNativePushModule();
      if (!mod) return;
      
      const platform = mod.getPlatform();
      // Remove this token from any other users first using security definer function
      // (RLS prevents deleting other users' rows directly)
      await supabase.rpc('cleanup_fcm_token_for_user', {
        p_token: token,
        p_user_id: userId,
      });
      
      // Get app version info
      let appVersion: string | null = null;
      let buildNumber: string | null = null;
      try {
        const { App } = await import('@capacitor/app');
        const info = await App.getInfo();
        appVersion = info.version;
        buildNumber = info.build;
      } catch {}
      
      // Use 'as any' since table may not be in generated types yet
      await supabase
        .from('fcm_tokens' as any)
        .upsert(
          {
            user_id: userId,
            token,
            platform,
            app_version: appVersion,
            build_number: buildNumber,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: 'user_id,token',
          }
        );
    } catch (err) {
      console.error('[useNativePush] Error saving refreshed token:', err);
    }
  }, [userId]);

  // BUG-1 fix: the action-tap handler now lives exclusively in
  // notificationLaunchHandler.ts (single Capacitor listener). We no longer
  // register a per-hook listener nor pass an onNotificationAction callback
  // into setupNativePushListeners — that previously caused 2-3 navigate()
  // calls per tap and broke the back stack.


  // Once we have an authenticated user, consume any pending push-tap nav
  // that arrived during the auth bootstrap. Without this, Index's redirect
  // chain can swallow the navigate() call fired from the early action listener.
  useEffect(() => {
    if (!userId || !isNative) return;
    // Try immediately and a couple of times after route settles
    const tryConsume = () => processPendingNotificationNavigation(navigate);
    if (tryConsume()) {
      console.log('[useNativePush] Consumed pending nav after auth ready');
      return;
    }
    const t1 = setTimeout(() => { if (tryConsume()) console.log('[useNativePush] Consumed pending nav post-auth (250ms)'); }, 250);
    const t2 = setTimeout(() => { if (tryConsume()) console.log('[useNativePush] Consumed pending nav post-auth (1000ms)'); }, 1000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [userId, isNative, navigate]);

  // Initialize native push when user is available
  useEffect(() => {
    if (!userId || !enabled || initializedRef.current) {
      return;
    }

    let cancelled = false;

    const init = async () => {
      try {
        const mod = await loadNativePushModule();
        if (!mod || cancelled) return;
        
        // Check if we're actually on a native platform
        if (!mod.isNativePlatform()) {
          console.log('[useNativePush] Not a native platform, skipping init');
          return;
        }

        console.log('[useNativePush] Initializing native push...');
        
        const result = await mod.initializeNativePush(userId);
        
        if (cancelled) return;
        
        if (result.success) {
          console.log('[useNativePush] Native push initialized successfully');
          initializedRef.current = true;
          
          // Setup listeners - wrap in try/catch
          try {
            cleanupRef.current = mod.setupNativePushListeners(
              // onNotificationReceived - show toast for foreground notifications
              (notification) => {
                try {
                  toast(notification.title || 'New notification', {
                    description: notification.body,
                  });
                } catch (toastErr) {
                  console.warn('[useNativePush] Failed to show toast:', toastErr);
                }
              },
              // onNotificationAction - handled centrally in notificationLaunchHandler.ts (BUG-1)
              undefined,
              // onTokenRefresh - save new token
              handleTokenRefresh
            );
          } catch (listenerErr) {
            console.warn('[useNativePush] Failed to setup listeners:', listenerErr);
          }
        } else {
          console.warn('[useNativePush] Failed to initialize:', result.error);
        }
      } catch (err) {
        // Catch ANY error to prevent app crashes
        console.error('[useNativePush] Critical error during init:', err);
      }
    };

    init();

    return () => {
      cancelled = true;
      if (cleanupRef.current) {
        try {
          cleanupRef.current();
        } catch (err) {
          console.warn('[useNativePush] Error during cleanup:', err);
        }
        cleanupRef.current = null;
      }
    };
  }, [userId, enabled, handleTokenRefresh]);

  // Refresh FCM token whenever the native app returns to foreground.
  // Use both Capacitor App resume events and document visibility as a fallback.
  useEffect(() => {
    if (!userId || !isNative) return;

    let disposed = false;
    let lastRefreshAt = 0;
    let resumeListener: { remove: () => Promise<void> } | null = null;

    const refreshPushRegistration = async (source: 'resume' | 'visibilitychange') => {
      const now = Date.now();
      if (now - lastRefreshAt < 5000) {
        console.log(`[useNativePush] Skipping duplicate refresh from ${source}`);
        return;
      }

      lastRefreshAt = now;

      try {
        const mod = await loadNativePushModule();
        if (!mod || !mod.isNativePlatform() || disposed) return;

        console.log(`[useNativePush] App foregrounded via ${source} - refreshing FCM token`);
        const result = await mod.initializeNativePush(userId);
        if (result.success) {
          console.log(`[useNativePush] FCM token refreshed via ${source}`);
        } else {
          console.warn(`[useNativePush] FCM token refresh via ${source} failed:`, result.error);
        }
      } catch (err) {
        console.warn(`[useNativePush] Error refreshing token via ${source}:`, err);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshPushRegistration('visibilitychange');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    void loadCapacitorAppModule().then((appMod) => {
      if (!appMod || disposed) return;

      appMod.App.addListener('resume', () => {
        void refreshPushRegistration('resume');
      }).then((listener) => {
        if (!disposed) {
          resumeListener = listener;
        } else {
          listener.remove().catch(() => {});
        }
      }).catch((err) => {
        console.warn('[useNativePush] Failed to attach resume listener:', err);
      });
    });

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      resumeListener?.remove().catch(() => {});
    };
  }, [userId, isNative]);

  // Cleanup on logout
  const cleanup = useCallback(async () => {
    if (!userId) return;
    
    try {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      
      const mod = await loadNativePushModule();
      if (mod) {
        await mod.unregisterNativePush(userId);
      }
      initializedRef.current = false;
    } catch (err) {
      console.error('[useNativePush] Error during cleanup:', err);
    }
  }, [userId]);

  return {
    isNative,
    cleanup,
  };
}
