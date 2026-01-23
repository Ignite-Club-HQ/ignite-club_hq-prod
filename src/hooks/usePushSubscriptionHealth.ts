import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { subscribeToPushNotifications, checkPushSubscription } from "@/lib/pushNotifications";

// How often to validate subscription (every 4 hours)
const VALIDATION_INTERVAL_MS = 4 * 60 * 60 * 1000;
// Key for storing last validation timestamp
const LAST_VALIDATION_KEY = "push_last_validation";
// Debounce visibility changes
const VISIBILITY_DEBOUNCE_MS = 2000;

/**
 * Enhanced push subscription health check
 * - Listens for subscription change messages from service worker
 * - Periodically validates subscription is still active
 * - Revalidates when app becomes visible (user returns)
 * - Ensures browser and DB subscriptions are in sync
 */
export function usePushSubscriptionHealth(userId: string | undefined) {
  const isValidating = useRef(false);
  const visibilityTimeout = useRef<NodeJS.Timeout | null>(null);

  /**
   * Validate subscription is healthy and in sync with database
   */
  const validateSubscription = useCallback(async (force = false): Promise<boolean> => {
    if (!userId || isValidating.current) return false;
    
    // Check if we need to validate (cooldown)
    if (!force) {
      try {
        const lastValidation = localStorage.getItem(LAST_VALIDATION_KEY);
        if (lastValidation) {
          const elapsed = Date.now() - parseInt(lastValidation, 10);
          if (elapsed < VALIDATION_INTERVAL_MS) {
            return true; // Assume healthy if recently validated
          }
        }
      } catch {
        // localStorage not available
      }
    }

    isValidating.current = true;
    console.log('[PushHealth] Starting subscription validation...');

    try {
      // Check if browser has an active subscription
      const hasSubscription = await checkPushSubscription(userId);
      
      if (!hasSubscription) {
        console.log('[PushHealth] No valid subscription found, resubscribing...');
        const result = await subscribeToPushNotifications(userId, true);
        
        if (result.success) {
          console.log('[PushHealth] Resubscribed successfully');
          updateLastValidation();
          return true;
        } else {
          console.warn('[PushHealth] Resubscription failed:', result.error);
          return false;
        }
      }

      // Verify DB has the subscription
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        try {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.getSubscription();
          
          if (subscription) {
            const { data: dbSub } = await supabase
              .from('push_subscriptions')
              .select('id, endpoint')
              .eq('user_id', userId)
              .eq('endpoint', subscription.endpoint)
              .maybeSingle();

            if (!dbSub) {
              console.log('[PushHealth] Browser subscription not in DB, syncing...');
              const result = await subscribeToPushNotifications(userId, true);
              if (result.success) {
                console.log('[PushHealth] Synced subscription to DB');
              }
            } else {
              console.log('[PushHealth] Subscription validated - healthy');
            }
          }
        } catch (e) {
          console.warn('[PushHealth] Error checking subscription sync:', e);
        }
      }

      updateLastValidation();
      return true;
    } catch (error) {
      console.error('[PushHealth] Validation error:', error);
      return false;
    } finally {
      isValidating.current = false;
    }
  }, [userId]);

  /**
   * Update the last validation timestamp
   */
  const updateLastValidation = () => {
    try {
      localStorage.setItem(LAST_VALIDATION_KEY, Date.now().toString());
    } catch {
      // localStorage not available
    }
  };

  /**
   * Force resubscribe - useful when user manually triggers
   */
  const validateAndResubscribe = useCallback(async () => {
    if (!userId) return false;
    console.log('[PushHealth] Manual resubscription triggered');
    return subscribeToPushNotifications(userId);
  }, [userId]);

  useEffect(() => {
    if (!userId || !('serviceWorker' in navigator)) return;

    // Listen for subscription change messages from service worker
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PUSH_SUBSCRIPTION_CHANGED') {
        console.log('[PushHealth] SW reported subscription changed, resubscribing...');
        subscribeToPushNotifications(userId);
      }
      
      // Handle keepalive pong from SW
      if (event.data?.type === 'PONG') {
        console.log('[PushHealth] SW keepalive confirmed');
      }
    };

    navigator.serviceWorker.addEventListener('message', handleMessage);

    // Initial validation after short delay
    const initialTimer = setTimeout(() => validateSubscription(false), 3000);

    // Periodic validation
    const intervalTimer = setInterval(() => {
      validateSubscription(false);
    }, VALIDATION_INTERVAL_MS);

    // Validate when app becomes visible (debounced)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Debounce to avoid multiple rapid calls
        if (visibilityTimeout.current) {
          clearTimeout(visibilityTimeout.current);
        }
        visibilityTimeout.current = setTimeout(() => {
          validateSubscription(false);
        }, VISIBILITY_DEBOUNCE_MS);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Validate when coming back online
    const handleOnline = () => {
      console.log('[PushHealth] Device came online, validating subscription...');
      validateSubscription(true);
    };
    window.addEventListener('online', handleOnline);

    // Send keepalive ping to SW periodically
    const sendKeepalive = async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        if (registration.active) {
          registration.active.postMessage({ type: 'PING' });
        }
      } catch {
        // Ignore errors
      }
    };
    
    const keepaliveTimer = setInterval(sendKeepalive, 60000); // Every minute

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleMessage);
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
      clearInterval(keepaliveTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      if (visibilityTimeout.current) {
        clearTimeout(visibilityTimeout.current);
      }
    };
  }, [userId, validateSubscription]);

  return { 
    validateAndResubscribe,
    validateSubscription: () => validateSubscription(true)
  };
}
