import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { usePushSubscriptionHealth } from "@/hooks/usePushSubscriptionHealth";
import { useMissedNotificationSync } from "@/hooks/useMissedNotificationSync";
import { clearStalePushLocks } from "@/lib/pushNotifications";
import { useNativePush } from "@/hooks/useNativePush";
import { isNativePlatform } from "@/lib/nativePush";

/**
 * Component that manages push notification health checks and missed notification sync.
 * Handles both web push (for browsers) and native push (for Capacitor apps).
 * Must be placed inside AuthProvider.
 */
export function PushNotificationManager() {
  // Safely get auth context - component must be inside AuthProvider
  const { user } = useAuth();
  const navigate = useNavigate();
  
  // Initialize native push for Capacitor apps (no-op on web)
  useNativePush(user?.id);
  
  // Listen for SW postMessage navigation (when user taps a web push notification)
  useEffect(() => {
    if (isNativePlatform()) return;
    
    const handleSWMessage = (event: MessageEvent) => {
      if (event.data?.type === 'NOTIFICATION_CLICK_NAVIGATE' && event.data?.url) {
        console.log('[PushManager] SW navigation message received:', event.data.url);
        try {
          const url = event.data.url;
          if (url.startsWith('http://') || url.startsWith('https://')) {
            const parsed = new URL(url);
            navigate(parsed.pathname + parsed.search + parsed.hash);
          } else {
            navigate(url);
          }
        } catch (err) {
          console.error('[PushManager] Error navigating from SW message:', err);
          navigate(event.data.url);
        }
      }
    };
    
    navigator.serviceWorker?.addEventListener('message', handleSWMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', handleSWMessage);
  }, [navigate]);
  
  // Clear stale push locks on startup and visibility change (web only)
  useEffect(() => {
    // Skip web push management on native platforms
    if (isNativePlatform()) return;
    
    // Clear on mount
    clearStalePushLocks();
    
    // Also clear when app becomes visible (user returns to app)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        clearStalePushLocks();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);
  
  // Run push subscription health checks (web only - skip on native)
  usePushSubscriptionHealth(isNativePlatform() ? undefined : user?.id);
  
  // Sync missed notifications when app opens
  useMissedNotificationSync(user?.id);
  
  // This component renders nothing - it just runs hooks
  return null;
}
