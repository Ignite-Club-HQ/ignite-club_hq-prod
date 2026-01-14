import { useAuth } from "@/hooks/useAuth";
import { usePushSubscriptionHealth } from "@/hooks/usePushSubscriptionHealth";
import { useMissedNotificationSync } from "@/hooks/useMissedNotificationSync";

/**
 * Component that manages push notification health checks and missed notification sync.
 * Must be placed inside AuthProvider.
 */
export function PushNotificationManager() {
  // Safely get auth context - component must be inside AuthProvider
  const { user } = useAuth();
  
  // Run push subscription health checks
  usePushSubscriptionHealth(user?.id);
  
  // Sync missed notifications when app opens
  useMissedNotificationSync(user?.id);
  
  // This component renders nothing - it just runs hooks
  return null;
}
