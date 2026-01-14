import { useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

const LAST_SYNC_KEY = "notifications-last-sync";
const SYNC_COOLDOWN_MS = 30 * 1000; // Don't sync more than every 30 seconds

export function useMissedNotificationSync(userId: string | undefined) {
  const syncMissedNotifications = useCallback(async () => {
    if (!userId) return;

    try {
      // Check cooldown
      let lastSync: string | null = null;
      try {
        lastSync = localStorage.getItem(LAST_SYNC_KEY);
      } catch {
        // localStorage not available
      }
      if (lastSync && (Date.now() - parseInt(lastSync, 10)) < SYNC_COOLDOWN_MS) {
        return;
      }

      // Fetch unread notifications from the last 24 hours
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

      const { data: unreadNotifications, error } = await supabase
        .from("notifications")
        .select("id, message, type, created_at")
        .eq("user_id", userId)
        .eq("is_read", false)
        .gte("created_at", twentyFourHoursAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(5);

      if (error) {
        console.error("[NotificationSync] Error fetching notifications:", error);
        return;
      }

      try {
        localStorage.setItem(LAST_SYNC_KEY, Date.now().toString());
      } catch {
        // localStorage not available
      }

      if (unreadNotifications && unreadNotifications.length > 0) {
        console.log(`[NotificationSync] Found ${unreadNotifications.length} unread notification(s)`);
      }
    } catch (error) {
      console.error("[NotificationSync] Error syncing notifications:", error);
    }
  }, [userId]);

  // Sync on mount and when app becomes visible
  useEffect(() => {
    if (!userId) return;

    // Sync after a short delay on mount
    const mountTimer = setTimeout(syncMissedNotifications, 2000);

    // Sync when app becomes visible (user comes back to tab/app)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncMissedNotifications();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Sync when coming back online
    const handleOnline = () => {
      syncMissedNotifications();
    };
    window.addEventListener("online", handleOnline);

    return () => {
      clearTimeout(mountTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, [userId, syncMissedNotifications]);

  return { syncMissedNotifications };
}
