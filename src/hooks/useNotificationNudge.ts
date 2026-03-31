import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Capacitor } from "@capacitor/core";

const NUDGE_DISMISSED_PREFIX = "notification-nudge-dismissed-";
const NUDGE_COOLDOWN_DAYS = 7;

/**
 * Hook to determine if a user should be nudged to enable push notifications.
 * Checks FCM tokens (native) and push_subscriptions (web) to determine reachability.
 * Returns dismissal handlers with a 7-day cooldown.
 */
export function useNotificationNudge(userId: string | undefined, context: string = "general") {
  // Start as null (loading) — never show nudge while loading
  const [hasPushEnabled, setHasPushEnabled] = useState<boolean | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setHasPushEnabled(null);
      setIsLoading(false);
      return;
    }

    const dismissKey = `${NUDGE_DISMISSED_PREFIX}${context}-${userId}`;
    const dismissedAt = localStorage.getItem(dismissKey);
    if (dismissedAt) {
      const elapsed = Date.now() - parseInt(dismissedAt, 10);
      if (elapsed < NUDGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000) {
        setIsDismissed(true);
        setHasPushEnabled(true); // Don't show nudge
        setIsLoading(false);
        return;
      }
      // Cooldown expired, remove
      localStorage.removeItem(dismissKey);
    }

    // Delay check slightly to ensure auth session is fully settled
    const timer = setTimeout(async () => {
      try {
        // Verify we have an active session before querying
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData?.session) {
          setHasPushEnabled(null);
          setIsLoading(false);
          return;
        }

        const isNative = Capacitor.isNativePlatform();

        if (isNative) {
          // Check FCM tokens for native
          const { data, error } = await supabase
            .from("fcm_tokens" as any)
            .select("id")
            .eq("user_id", userId)
            .limit(1);
          setHasPushEnabled(!error && data && data.length > 0);
        } else {
          // Check push_subscriptions for web/PWA
          const { data, error } = await supabase
            .from("push_subscriptions")
            .select("id")
            .eq("user_id", userId)
            .limit(1);
          setHasPushEnabled(!error && data && data.length > 0);
        }
      } catch {
        // On error, assume enabled to avoid false nudges
        setHasPushEnabled(true);
      } finally {
        setIsLoading(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [userId, context]);

  const dismiss = useCallback(() => {
    if (!userId) return;
    const dismissKey = `${NUDGE_DISMISSED_PREFIX}${context}-${userId}`;
    localStorage.setItem(dismissKey, Date.now().toString());
    setIsDismissed(true);
  }, [userId, context]);

  // Never show nudge while still loading — prevents false flash
  const shouldShowNudge = !isLoading && hasPushEnabled === false && !isDismissed;

  return { shouldShowNudge, hasPushEnabled, dismiss };
}
