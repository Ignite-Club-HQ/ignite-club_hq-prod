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
  
  // Helper to navigate from a push notification URL
  const navigateToUrl = (url: string) => {
    try {
      // Check if external URL (e.g. App Store / Play Store)
      if (url.startsWith('http://') || url.startsWith('https://')) {
        const parsed = new URL(url);
        const appDomains = ['igniteclubhq.app', 'lovable.app', 'lovableproject.com', 'localhost'];
        const isExternal = !appDomains.some(d => parsed.hostname.endsWith(d));
        if (isExternal) {
          console.log('[PushManager] External URL detected, opening in new tab:', url);
          window.open(url, '_blank');
          return;
        }
        navigate(parsed.pathname + parsed.search + parsed.hash);
      } else {
        navigate(url);
      }
    } catch (err) {
      console.error('[PushManager] Error navigating:', err);
      navigate(url);
    }
  };

  // Listen for SW notification click navigation via multiple channels
  // BroadcastChannel is more reliable than postMessage for PWA clients resuming from suspension
  useEffect(() => {
    if (isNativePlatform()) return;
    
    // Primary: BroadcastChannel (works even when client is resuming from suspension)
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('push-nav');
      bc.onmessage = (event) => {
        if (event.data?.url) {
          console.log('[PushManager] BroadcastChannel navigation received:', event.data.url);
          navigateToUrl(event.data.url);
        }
      };
    } catch (e) {
      console.warn('[PushManager] BroadcastChannel not available:', e);
    }
    
    // Backup: SW postMessage
    const handleSWMessage = (event: MessageEvent) => {
      if (event.data?.type === 'NOTIFICATION_CLICK_NAVIGATE' && event.data?.url) {
        console.log('[PushManager] SW postMessage navigation received:', event.data.url);
        navigateToUrl(event.data.url);
      }
    };
    
    navigator.serviceWorker?.addEventListener('message', handleSWMessage);
    return () => {
      bc?.close();
      navigator.serviceWorker?.removeEventListener('message', handleSWMessage);
    };
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
