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
import { processPendingNotificationNavigation } from '@/lib/notificationLaunchHandler';

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

export function useNativePush(userId: string | undefined, options: UseNativePushOptions = {}) {
  const { enabled = true } = options;
  const navigate = useNavigate();
  const cleanupRef = useRef<(() => void) | null>(null);
  const initializedRef = useRef(false);
  const [isNative, setIsNative] = useState(false);
  const pendingNavProcessed = useRef(false);

  // Check if we're on native platform and handle pending notification navigation
  useEffect(() => {
    loadNativePushModule().then(mod => {
      if (mod) {
        try {
          const native = mod.isNativePlatform();
          setIsNative(native);
          
          // On native, check for any pending notification navigation
          if (native && !pendingNavProcessed.current) {
            pendingNavProcessed.current = true;
            const wasProcessed = processPendingNotificationNavigation(navigate);
            if (wasProcessed) {
              console.log('[useNativePush] Processed pending notification navigation');
            }
          }
        } catch {
          setIsNative(false);
        }
      }
    });
  }, [navigate]);

  // Save refreshed token to database
  const handleTokenRefresh = useCallback(async (token: string) => {
    if (!userId) return;
    
    console.log('[useNativePush] Token refreshed, saving...');
    try {
      const mod = await loadNativePushModule();
      if (!mod) return;
      
      const platform = mod.getPlatform();
      // Use 'as any' since table may not be in generated types yet
      await supabase
        .from('fcm_tokens' as any)
        .upsert(
          {
            user_id: userId,
            token,
            platform,
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

  // Handle notification tap - navigate to relevant page
  const handleNotificationAction = useCallback((notification: any) => {
    try {
      const data = notification.notification?.data;
      if (data?.url) {
        // Parse the URL and navigate
        try {
          const url = new URL(data.url, window.location.origin);
          navigate(url.pathname + url.search);
        } catch {
          // Fallback to direct navigation
          navigate(data.url);
        }
      }
    } catch (err) {
      console.error('[useNativePush] Error handling notification action:', err);
    }
  }, [navigate]);

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
              // onNotificationAction - handle tap
              handleNotificationAction,
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
  }, [userId, enabled, handleNotificationAction, handleTokenRefresh]);

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
