import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { isChatWsHealthy, subscribeChatPokes } from "@/live/wsRealtime";

interface DirectMessageUpdatesOptions {
  conversationId?: string;
  userId?: string;
  enabled: boolean;
  messagingOnIcp: boolean;
  queryClient: QueryClient;
  subscribeSupabase: () => void | (() => void);
}

// Only the selected transport may subscribe; ICP pokes and foreground polling
// refetch through the page's existing authorized message/reaction reader.
export function useDirectMessageUpdates({
  conversationId, userId, enabled, messagingOnIcp, queryClient, subscribeSupabase,
}: DirectMessageUpdatesOptions) {
  useEffect(() => {
    if (!enabled || !conversationId || !userId) return;
    if (!messagingOnIcp) return subscribeSupabase();

    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void queryClient.invalidateQueries({ queryKey: ["dm-messages", conversationId] });
    };
    const unsubscribe = subscribeChatPokes(refresh);
    const timer = window.setInterval(() => {
      if (!isChatWsHealthy()) refresh();
    }, 15_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [conversationId, userId, enabled, messagingOnIcp, queryClient, subscribeSupabase]);
}