import { useEffect } from "react";
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
  
  // Initialize native push for Capacitor apps (no-op on web)
  useNativePush(user?.id);
  
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
