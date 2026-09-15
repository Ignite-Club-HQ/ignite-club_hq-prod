import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { notificationKeys } from "./queryKeys";
import type { NotificationListItem } from "./notificationRepository";

type RealtimeNotificationRow = Omit<NotificationListItem, "read"> & {
  is_read: boolean;
};

function toNotification(row: RealtimeNotificationRow): NotificationListItem {
  return { ...row, read: row.is_read };
}

export function useNotificationRealtime(
  userId: string | undefined,
  queryClient: QueryClient,
  refreshUnreadCount: () => void,
): void {
  useEffect(() => {
    if (!userId) return;

    // This topic must remain distinct from useAuth's global unread-count
    // channel. Supabase returns an existing channel for a duplicate topic and
    // rejects callbacks added after that channel has subscribed.
    const channel = supabase
      .channel(`notifications-page-${userId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        const inserted = toNotification(payload.new as RealtimeNotificationRow);
        queryClient.setQueriesData<NotificationListItem[]>(
          { queryKey: [notificationKeys.lists[0], userId] },
          (old) => old ? [inserted, ...old] : [inserted],
        );
        refreshUnreadCount();
      })
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        const updated = toNotification(payload.new as RealtimeNotificationRow);
        queryClient.setQueriesData<NotificationListItem[]>(
          { queryKey: [notificationKeys.lists[0], userId] },
          (old) => old?.map((notification) => notification.id === updated.id ? updated : notification) ?? [],
        );
      })
      .on("postgres_changes", {
        event: "DELETE",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        const deleted = payload.old as { id: string };
        queryClient.setQueriesData<NotificationListItem[]>(
          { queryKey: [notificationKeys.lists[0], userId] },
          (old) => old?.filter((notification) => notification.id !== deleted.id) ?? [],
        );
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, refreshUnreadCount, userId]);
}
