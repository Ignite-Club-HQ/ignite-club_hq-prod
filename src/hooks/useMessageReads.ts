import { useEffect, useCallback, useMemo, useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type MessageType = "team" | "club" | "group" | "broadcast" | "dm" | "club_admin";

export interface ReaderInfo {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

const getMessageIdField = (type: MessageType) => {
  switch (type) {
    case "team": return "team_message_id";
    case "club": return "club_message_id";
    case "group": return "group_message_id";
    case "broadcast": return "broadcast_message_id";
    case "dm": return "direct_message_id";
    case "club_admin": return "club_admin_message_id";
  }
};

// Debounce delay in ms
const DEBOUNCE_DELAY = 1000;

// Session-level cache for messages already marked as read by current user
const markedAsReadCache = new Set<string>();

// Local storage cache for read counts
const READ_COUNTS_CACHE_KEY = "message_read_counts";
const READ_COUNTS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getReadCountsFromCache(contextId: string): Record<string, number> | null {
  try {
    const cached = localStorage.getItem(`${READ_COUNTS_CACHE_KEY}_${contextId}`);
    if (!cached) return null;
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > READ_COUNTS_CACHE_TTL) {
      localStorage.removeItem(`${READ_COUNTS_CACHE_KEY}_${contextId}`);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function setReadCountsToCache(contextId: string, counts: Record<string, number>) {
  try {
    localStorage.setItem(
      `${READ_COUNTS_CACHE_KEY}_${contextId}`,
      JSON.stringify({ data: counts, timestamp: Date.now() })
    );
  } catch {}
}

/**
 * Compute read frontier: for each reader, find the latest message they've read
 * (based on message order in the messageIds array).
 * Returns a map: messageId -> array of readers whose frontier is that message.
 */
function computeReadFrontier(
  readersByMessage: Record<string, ReaderInfo[]>,
  messageIds: string[],
  currentUserId?: string
): Record<string, ReaderInfo[]> {
  // Build messageId -> index map for ordering
  const messageIndexMap = new Map<string, number>();
  messageIds.forEach((id, idx) => messageIndexMap.set(id, idx));

  // For each reader, find the highest-index message they've read
  const readerFrontier = new Map<string, { messageId: string; index: number; info: ReaderInfo }>();

  for (const [msgId, readers] of Object.entries(readersByMessage)) {
    const msgIndex = messageIndexMap.get(msgId);
    if (msgIndex === undefined) continue;

    for (const reader of readers) {
      // Skip current user's own reads
      if (reader.user_id === currentUserId) continue;

      const existing = readerFrontier.get(reader.user_id);
      if (!existing || msgIndex > existing.index) {
        readerFrontier.set(reader.user_id, { messageId: msgId, index: msgIndex, info: reader });
      }
    }
  }

  // Group by frontier messageId
  const frontier: Record<string, ReaderInfo[]> = {};
  for (const { messageId, info } of readerFrontier.values()) {
    if (!frontier[messageId]) frontier[messageId] = [];
    frontier[messageId].push(info);
  }

  return frontier;
}

export function useMessageReads(
  messageType: MessageType,
  contextId: string,
  messageIds: string[],
  currentUserId?: string
) {
  const messageIdField = getMessageIdField(messageType);

  const [readCounts, setReadCounts] = useState<Record<string, number>>(() =>
    getReadCountsFromCache(contextId) || {}
  );

  // Track per-message readers (userId -> profile info)
  const [readersByMessage, setReadersByMessage] = useState<Record<string, ReaderInfo[]>>({});

  // Computed read frontier
  const readFrontier = useMemo(
    () => computeReadFrontier(readersByMessage, messageIds, currentUserId),
    [readersByMessage, messageIds, currentUserId]
  );

  const pendingReadsRef = useRef<Set<string>>(new Set());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageIdsSetRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    messageIdsSetRef.current = new Set(messageIds);
  }, [messageIds]);

  const messageIdsKey = useMemo(() => {
    if (messageIds.length === 0) return "";
    return `${messageIds.length}:${messageIds[0]}:${messageIds[messageIds.length - 1]}`;
  }, [messageIds]);

  // Fetch initial read counts and reader profiles
  useEffect(() => {
    if (messageIds.length === 0) return;

    const cached = getReadCountsFromCache(contextId);
    if (cached) {
      setReadCounts(prev => ({ ...prev, ...cached }));
    }

    const fetchReadCounts = async () => {
      // Fetch reads (no join - message_reads has no FK to profiles)
      const { data, error } = await (supabase
        .from("message_reads")
        .select(`${messageIdField}, user_id`) as any)
        .in(messageIdField, messageIds);

      if (error) {
        console.error("Error fetching message reads:", error);
        return;
      }

      // Collect unique user IDs for profile fetch
      const userIds = new Set<string>();
      const readsData: Array<{ msgId: string; userId: string }> = [];

      for (const read of data || []) {
        const msgId = (read as any)[messageIdField] as string | null;
        const userId = (read as any).user_id as string;
        if (!msgId) continue;
        readsData.push({ msgId, userId });
        userIds.add(userId);

        if (currentUserId && userId === currentUserId) {
          markedAsReadCache.add(`${messageType}:${msgId}`);
        }
      }

      // Fetch profiles for all readers
      const profileMap = new Map<string, { display_name: string | null; avatar_url: string | null }>();
      if (userIds.size > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", Array.from(userIds));
        for (const p of profiles || []) {
          profileMap.set(p.id, { display_name: p.display_name, avatar_url: p.avatar_url });
        }
      }

      const readers: Record<string, Map<string, ReaderInfo>> = {};
      for (const { msgId, userId } of readsData) {
        if (!readers[msgId]) readers[msgId] = new Map();
        const profile = profileMap.get(userId);
        readers[msgId].set(userId, {
          user_id: userId,
          display_name: profile?.display_name || null,
          avatar_url: profile?.avatar_url || null,
        });
      }

      const counts: Record<string, number> = {};
      const readersMap: Record<string, ReaderInfo[]> = {};
      for (const [msgId, readerMap] of Object.entries(readers)) {
        counts[msgId] = readerMap.size;
        readersMap[msgId] = Array.from(readerMap.values());
      }

      setReadCounts((prev) => {
        const updated = { ...prev, ...counts };
        setReadCountsToCache(contextId, updated);
        return updated;
      });
      setReadersByMessage(readersMap);
    };

    fetchReadCounts();
  }, [messageIdsKey, messageIdField, contextId, currentUserId, messageType]);

  // Mark messages as read (batched)
  const markAsReadMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!currentUserId || ids.length === 0) return;

      // Guard: ensure we still have a valid auth session before writing.
      // Without this, a stale React state during sign-out / token refresh
      // sends inserts that get rejected by RLS — wasting a connection per
      // try and contributing to pool exhaustion.
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) return;

      // Single RPC call: the database uses auth.uid() and ON CONFLICT DO NOTHING,
      // so duplicate read attempts are ignored without creating 23505 log noise.
      const { error } = await (supabase as any).rpc("mark_message_reads", {
        _message_type: messageType,
        _message_ids: ids,
      });

      if (error && error.code !== "23505" && !error.message?.includes("duplicate")) {
        console.error("Error marking messages as read:", error);
      }
    },
    onMutate: (ids: string[]) => {
      if (!currentUserId) return;
      setReadCounts((prev) => {
        const updated = { ...prev };
        for (const id of ids) {
          updated[id] = (updated[id] || 0) + 1;
        }
        setReadCountsToCache(contextId, updated);
        return updated;
      });
    },
  });

  const flushPendingReads = useCallback(() => {
    if (pendingReadsRef.current.size === 0 || !currentUserId) return;
    const idsToMark = Array.from(pendingReadsRef.current);
    pendingReadsRef.current.clear();
    markAsReadMutation.mutate(idsToMark);
  }, [currentUserId, markAsReadMutation]);

  const markMessagesAsRead = useCallback(
    (visibleMessageIds: string[]) => {
      if (!currentUserId || visibleMessageIds.length === 0) return;
      const newIds = visibleMessageIds.filter(
        id => !markedAsReadCache.has(`${messageType}:${id}`)
      );
      if (newIds.length === 0) return;

      for (const id of newIds) {
        pendingReadsRef.current.add(id);
        markedAsReadCache.add(`${messageType}:${id}`);
      }

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(flushPendingReads, DEBOUNCE_DELAY);
    },
    [currentUserId, messageType, flushPendingReads]
  );

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        if (pendingReadsRef.current.size > 0 && currentUserId) {
          flushPendingReads();
        }
      }
    };
  }, [currentUserId, flushPendingReads]);

  // Realtime: update counts and reader info from payload.
  // Narrowed via scope_key (populated by BEFORE INSERT trigger) so each
  // open chat only receives reads for its own scope instead of every
  // message_reads INSERT platform-wide.
  useEffect(() => {
    if (messageIds.length === 0 || !contextId) return;

    const scopeKey = messageType === "broadcast" ? "broadcast" : contextId;

    const channel = supabase
      .channel(`message-reads-${messageType}-${contextId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_reads",
          filter: `scope_key=eq.${scopeKey}`,
        },
        async (payload) => {
          const newRead = payload.new as Record<string, any>;
          const msgId = newRead[messageIdField] as string | null;
          const userId = newRead.user_id as string;
          if (!msgId || !messageIdsSetRef.current.has(msgId)) return;

          // Increment count
          setReadCounts((prev) => {
            const updated = { ...prev, [msgId]: (prev[msgId] || 0) + 1 };
            setReadCountsToCache(contextId, updated);
            return updated;
          });

          // Fetch the reader's profile for avatar display
          if (userId !== currentUserId) {
            const { data: profile } = await supabase
              .from("profiles")
              .select("display_name, avatar_url")
              .eq("id", userId)
              .maybeSingle();

            setReadersByMessage((prev) => {
              const existing = prev[msgId] || [];
              if (existing.some(r => r.user_id === userId)) return prev;
              return {
                ...prev,
                [msgId]: [...existing, {
                  user_id: userId,
                  display_name: profile?.display_name || null,
                  avatar_url: profile?.avatar_url || null,
                }],
              };
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [messageType, contextId, messageIdField, messageIdsKey, currentUserId]);


  return {
    readCounts,
    readFrontier,
    markMessagesAsRead,
  };
}
