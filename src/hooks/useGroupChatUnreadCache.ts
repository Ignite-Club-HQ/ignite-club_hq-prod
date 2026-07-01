import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const groupChatUnreadCacheKey = (userId: string | null | undefined) =>
  ["chat-group-unread-cache", userId] as const;

type UnreadMap = Record<string, number>;

/**
 * Reads the current user's per-group unread counts from the denormalised
 * `chat_group_unread` cache table. Backed by triggers on `group_messages`
 * (bump) and `message_reads` (clear), so it stays in sync with the source
 * of truth automatically.
 *
 * Why this exists: previously each group-chat row badge on MessagesPage
 * pulled its count from the `get_unread_message_counts` RPC, which JOINs
 * `notifications` → `group_messages` and re-aggregates every refetch. The
 * cache table gives O(1) row lookups and — via realtime — instant per-row
 * updates without waiting on the RPC's staleTime/refetch cycle.
 *
 * Realtime filter is scoped to `user_id=eq.{userId}` so each client only
 * receives its own row changes. INSERT/UPDATE payloads carry the new
 * `unread_count`, so we patch the cache in-place instead of refetching.
 */
export function useGroupChatUnreadCache(userId: string | null | undefined) {
  const queryClient = useQueryClient();
  const key = groupChatUnreadCacheKey(userId);

  const query = useQuery<UnreadMap>({
    queryKey: key,
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    initialData: {} as UnreadMap,
    initialDataUpdatedAt: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_group_unread")
        .select("group_id, unread_count")
        .eq("user_id", userId!)
        .gt("unread_count", 0);
      if (error) throw error;
      const map: UnreadMap = {};
      (data ?? []).forEach((row: any) => {
        if (row.group_id) map[row.group_id] = Number(row.unread_count) || 0;
      });
      return map;
    },
  });

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`chat-group-unread-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_group_unread",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          queryClient.setQueryData<UnreadMap>(key, (prev) => {
            const next: UnreadMap = { ...(prev ?? {}) };
            const row: any = payload.new ?? payload.old;
            const groupId: string | undefined = row?.group_id;
            if (!groupId) return prev ?? {};

            if (payload.eventType === "DELETE") {
              delete next[groupId];
              return next;
            }
            const count = Number((payload.new as any)?.unread_count) || 0;
            if (count > 0) {
              next[groupId] = count;
            } else {
              delete next[groupId];
            }
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // key intentionally excluded — it changes only when userId changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, queryClient]);

  return query;
}
