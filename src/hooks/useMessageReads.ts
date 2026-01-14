import { useEffect, useCallback, useMemo, useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type MessageType = "team" | "club" | "group" | "broadcast";

const getMessageIdField = (type: MessageType) => {
  switch (type) {
    case "team":
      return "team_message_id";
    case "club":
      return "club_message_id";
    case "group":
      return "group_message_id";
    case "broadcast":
      return "broadcast_message_id";
  }
};

// Debounce delay in ms - increased for better batching
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
  } catch {
    // Ignore storage errors
  }
}

export function useMessageReads(
  messageType: MessageType,
  contextId: string,
  messageIds: string[],
  currentUserId?: string
) {
  const messageIdField = getMessageIdField(messageType);

  // Local state for read counts - updated directly from realtime, no refetch
  const [readCounts, setReadCounts] = useState<Record<string, number>>(() => 
    getReadCountsFromCache(contextId) || {}
  );

  // Debounce queue for batching reads
  const pendingReadsRef = useRef<Set<string>>(new Set());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Track message IDs as a Set for O(1) lookups
  const messageIdsSetRef = useRef<Set<string>>(new Set());
  
  useEffect(() => {
    messageIdsSetRef.current = new Set(messageIds);
  }, [messageIds]);

  // Stable key for initial fetch - only fetch when message list significantly changes
  const messageIdsKey = useMemo(() => {
    if (messageIds.length === 0) return "";
    return `${messageIds.length}:${messageIds[0]}:${messageIds[messageIds.length - 1]}`;
  }, [messageIds]);

  // Fetch initial read counts once when messages load
  useEffect(() => {
    if (messageIds.length === 0) return;

    // Check cache first
    const cached = getReadCountsFromCache(contextId);
    if (cached) {
      // Only fetch for messages not in cache
      const uncachedIds = messageIds.filter(id => !(id in cached));
      if (uncachedIds.length === 0) {
        setReadCounts(prev => ({ ...prev, ...cached }));
        return;
      }
    }

    const fetchReadCounts = async () => {
      const { data, error } = await supabase
        .from("message_reads")
        .select(`${messageIdField}, user_id`)
        .in(messageIdField, messageIds);

      if (error) {
        console.error("Error fetching message reads:", error);
        return;
      }

      const readers: Record<string, Set<string>> = {};
      for (const read of data || []) {
        const msgId = (read as any)[messageIdField] as string | null;
        const userId = (read as any).user_id as string;
        if (!msgId) continue;
        if (!readers[msgId]) readers[msgId] = new Set();
        readers[msgId].add(userId);
        
        // Track that current user has already read these messages
        if (currentUserId && userId === currentUserId) {
          markedAsReadCache.add(`${messageType}:${msgId}`);
        }
      }

      const counts: Record<string, number> = {};
      for (const [msgId, readerSet] of Object.entries(readers)) {
        counts[msgId] = readerSet.size;
      }

      setReadCounts((prev) => {
        const updated = { ...prev, ...counts };
        setReadCountsToCache(contextId, updated);
        return updated;
      });
    };

    fetchReadCounts();
  }, [messageIdsKey, messageIdField, contextId, currentUserId, messageType]);

  // Mark messages as read (batched)
  const markAsReadMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!currentUserId || ids.length === 0) return;

      const rows = ids.map((messageId) => ({
        user_id: currentUserId,
        [messageIdField]: messageId,
      }));

      const { error } = await supabase.from("message_reads").upsert(rows as any, {
        onConflict: `user_id,${messageIdField}`,
        ignoreDuplicates: true,
      });

      if (error && !error.message.includes("duplicate")) {
        console.error("Error marking messages as read:", error);
      }
    },
    // Optimistic update - increment counts immediately
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

  // Flush pending reads - sends all queued message IDs at once
  const flushPendingReads = useCallback(() => {
    if (pendingReadsRef.current.size === 0 || !currentUserId) return;
    
    const idsToMark = Array.from(pendingReadsRef.current);
    pendingReadsRef.current.clear();
    markAsReadMutation.mutate(idsToMark);
  }, [currentUserId, markAsReadMutation]);

  // Debounced mark as read - queues IDs and flushes after delay
  const markMessagesAsRead = useCallback(
    (visibleMessageIds: string[]) => {
      if (!currentUserId || visibleMessageIds.length === 0) return;
      
      // Filter out messages already marked as read by this user
      const newIds = visibleMessageIds.filter(
        id => !markedAsReadCache.has(`${messageType}:${id}`)
      );
      
      if (newIds.length === 0) return;
      
      // Add to pending queue and mark in cache
      for (const id of newIds) {
        pendingReadsRef.current.add(id);
        markedAsReadCache.add(`${messageType}:${id}`);
      }
      
      // Clear existing timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      
      // Set new debounce timer
      debounceTimerRef.current = setTimeout(flushPendingReads, DEBOUNCE_DELAY);
    },
    [currentUserId, messageType, flushPendingReads]
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        // Flush any pending reads on unmount
        if (pendingReadsRef.current.size > 0 && currentUserId) {
          flushPendingReads();
        }
      }
    };
  }, [currentUserId, flushPendingReads]);

  // Realtime: update counts directly from payload, no refetch
  useEffect(() => {
    if (messageIds.length === 0) return;

    const channel = supabase
      .channel(`message-reads-${messageType}-${contextId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_reads",
        },
        (payload) => {
          const newRead = payload.new as Record<string, any>;
          const msgId = newRead[messageIdField] as string | null;
          if (!msgId || !messageIdsSetRef.current.has(msgId)) return;

          // Increment count directly in state
          setReadCounts((prev) => {
            const updated = {
              ...prev,
              [msgId]: (prev[msgId] || 0) + 1,
            };
            setReadCountsToCache(contextId, updated);
            return updated;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [messageType, contextId, messageIdField, messageIdsKey]);

  return {
    readCounts,
    markMessagesAsRead,
  };
}
