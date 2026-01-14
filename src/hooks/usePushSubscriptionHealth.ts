import { useEffect } from "react";
import { subscribeToPushNotifications } from "@/lib/pushNotifications";

/**
 * Simplified push subscription health check
 * Listens for subscription change messages from service worker
 */
export function usePushSubscriptionHealth(userId: string | undefined) {
  useEffect(() => {
    if (!userId || !('serviceWorker' in navigator)) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PUSH_SUBSCRIPTION_CHANGED') {
        console.log('[PushHealth] Subscription changed, resubscribing...');
        subscribeToPushNotifications(userId);
      }
    };

    navigator.serviceWorker.addEventListener('message', handleMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleMessage);
    };
  }, [userId]);

  return { validateAndResubscribe: () => userId && subscribeToPushNotifications(userId) };
}
