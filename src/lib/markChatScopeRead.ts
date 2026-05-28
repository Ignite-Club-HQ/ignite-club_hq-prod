import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  createEmptyUnreadMessageCounts,
  getTotalUnreadMessageCount,
  type UnreadMessageCounts,
} from "@/lib/unreadMessageCounts";

type Scope =
  | { kind: "team"; teamId: string }
  | { kind: "club"; clubId: string }
  | { kind: "group"; groupId: string }
  | { kind: "dm"; conversationId: string }
  | { kind: "broadcast" };

interface Args {
  userId: string;
  scope: Scope;
  queryClient: QueryClient;
  /** Optimistically decrement the bell badge by this many items. */
  decrementUnreadCount: (n: number) => void;
  /** Safety-net refetch in case the optimistic delta drifts. */
  refreshUnreadCount: () => Promise<void> | void;
}

/**
 * Centralized mark-as-read for chat threads. Does the work in this order so
 * the bell badge and Messages tab unread indicator clear *immediately* when
 * the user opens a thread, instead of waiting 5-10s for the round-trip:
 *
 *   1. Read the current `unread-message-counts` cache and compute how many
 *      unread notifications belong to this scope.
 *   2. Optimistically zero the scope in the cache and decrement the bell
 *      badge by the same amount.
 *   3. Fire the DB UPDATE in the background (no await).
 *   4. Once the UPDATE resolves, invalidate the relevant queries so realtime
 *      drift is corrected.
 */
export function markChatScopeNotificationsRead({
  userId,
  scope,
  queryClient,
  decrementUnreadCount,
  refreshUnreadCount,
}: Args) {
  // 1 + 2: optimistic local update
  const cacheKey = ["unread-message-counts", userId];
  const current =
    queryClient.getQueryData<UnreadMessageCounts>(cacheKey) ??
    createEmptyUnreadMessageCounts();

  let scopeCount = 0;
  const next: UnreadMessageCounts = {
    broadcast: current.broadcast,
    teams: { ...current.teams },
    clubs: { ...current.clubs },
    groups: { ...current.groups },
    dms: { ...current.dms },
  };

  switch (scope.kind) {
    case "broadcast":
      scopeCount = next.broadcast;
      next.broadcast = 0;
      break;
    case "team":
      scopeCount = next.teams[scope.teamId] ?? 0;
      delete next.teams[scope.teamId];
      break;
    case "club":
      scopeCount = next.clubs[scope.clubId] ?? 0;
      delete next.clubs[scope.clubId];
      break;
    case "group":
      scopeCount = next.groups[scope.groupId] ?? 0;
      delete next.groups[scope.groupId];
      break;
    case "dm":
      scopeCount = next.dms[scope.conversationId] ?? 0;
      delete next.dms[scope.conversationId];
      break;
  }

  if (scopeCount > 0) {
    queryClient.setQueryData(cacheKey, next);
    decrementUnreadCount(scopeCount);

    // Optimistically decrement the club-scoped badges too (BottomNav Messages
    // pill + AppHeader bell when a club filter is active). Without this they
    // wait for the realtime UPDATE → invalidate → refetch round-trip, which
    // can take 10-15s on slow networks/mobile.
    queryClient.setQueriesData<number>({ queryKey: ["club-messages-unread"] }, (old) =>
      typeof old === "number" ? Math.max(0, old - scopeCount) : old
    );
    queryClient.setQueriesData<number>({ queryKey: ["club-unread-count"] }, (old) =>
      typeof old === "number" ? Math.max(0, old - scopeCount) : old
    );
  }

  // 3: background DB UPDATE (fire-and-forget — do NOT await)
  void (async () => {
    let q = supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("is_read", false);

    switch (scope.kind) {
      case "broadcast":
        q = q.eq("type", "broadcast");
        break;
      case "team":
        // Must scope by related_id — otherwise opening one team chat clears
        // unread notifications for EVERY team the user is in.
        q = q.eq("type", "team_message").eq("related_id", scope.teamId);
        break;
      case "club":
        q = q.eq("type", "club_message").eq("related_id", scope.clubId);
        break;
      case "group":
        q = q.eq("type", "group_message").eq("related_id", scope.groupId);
        break;
      case "dm":
        q = q.eq("type", "direct_message").eq("related_id", scope.conversationId);
        break;
    }

    try {
      await q;
    } catch (err) {
      console.warn("[markChatScopeNotificationsRead] update failed", err);
    }

    // 3b: also clear message_reply / message_mention notifications whose
    // related message belongs to this scope. Without this, opening a chat
    // leaves these notifications behind — the bell + Messages tab badges
    // "snap back" to a non-zero count after the realtime UPDATE → invalidate
    // → server refetch round-trip completes.
    try {
      const scopeTable =
        scope.kind === "team" ? "team_messages" :
        scope.kind === "club" ? "club_messages" :
        scope.kind === "group" ? "group_messages" :
        scope.kind === "dm" ? "direct_messages" : null;
      const scopeCol =
        scope.kind === "team" ? "team_id" :
        scope.kind === "club" ? "club_id" :
        scope.kind === "group" ? "group_id" :
        scope.kind === "dm" ? "conversation_id" : null;
      const scopeId =
        scope.kind === "team" ? scope.teamId :
        scope.kind === "club" ? scope.clubId :
        scope.kind === "group" ? scope.groupId :
        scope.kind === "dm" ? scope.conversationId : null;

      if (scopeTable && scopeCol && scopeId) {
        const { data: notifs } = await supabase
          .from("notifications")
          .select("id, related_id")
          .eq("user_id", userId)
          .eq("is_read", false)
          .in("type", ["message_reply", "message_mention"]);

        const relatedIds = Array.from(
          new Set((notifs ?? []).map((n: any) => n.related_id).filter(Boolean))
        ) as string[];

        if (relatedIds.length > 0) {
          const { data: scopedMsgs } = await (supabase as any)
            .from(scopeTable)
            .select("id")
            .eq(scopeCol, scopeId)
            .in("id", relatedIds);

          const scopedSet = new Set<string>((scopedMsgs ?? []).map((m: any) => m.id));
          const notifIdsToMark = (notifs ?? [])
            .filter((n: any) => scopedSet.has(n.related_id))
            .map((n: any) => n.id as string);

          if (notifIdsToMark.length > 0) {
            await supabase
              .from("notifications")
              .update({ is_read: true })
              .in("id", notifIdsToMark);
            decrementUnreadCount(notifIdsToMark.length);
            queryClient.setQueriesData<number>({ queryKey: ["club-messages-unread"] }, (old) =>
              typeof old === "number" ? Math.max(0, old - notifIdsToMark.length) : old
            );
            queryClient.setQueriesData<number>({ queryKey: ["club-unread-count"] }, (old) =>
              typeof old === "number" ? Math.max(0, old - notifIdsToMark.length) : old
            );
          }
        }
      }
    } catch (err) {
      console.warn("[markChatScopeNotificationsRead] reply/mention sweep failed", err);
    }

    // 4: reconcile (covers any drift if the optimistic count was off, and
    // refreshes the inbox/recent-notifications dropdown).
    try {
      await refreshUnreadCount();
    } catch { }
    queryClient.invalidateQueries({ queryKey: ["unread-message-counts", userId] });
    queryClient.invalidateQueries({ queryKey: ["recent-notifications"] });
    // Keep total in sync if anything else was watching it.
    const post = queryClient.getQueryData<UnreadMessageCounts>(cacheKey);
    if (post) {
      // no-op; getTotalUnreadMessageCount available for callers that want it
      void getTotalUnreadMessageCount(post);
    }
  })();
}
