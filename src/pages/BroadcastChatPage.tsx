import React, { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect } from "react";
import { consumePendingChatJump, subscribePendingChatJump, type PendingChatJumpPayload } from "@/lib/pendingChatJump";
import { fuzzyMatchesQuery } from "@/lib/fuzzySearch";
import { useChatDraft } from "@/hooks/useChatDraft";
import { useChatViewportHeight } from "@/hooks/useChatViewportHeight";
import { ChatMessagesScroller } from "@/components/chat/ChatMessagesScroller";
import type { VirtualizedChatMessageListHandle } from "@/components/chat/VirtualizedChatMessageList";
import { useMeasuredElementHeight } from "@/hooks/useMeasuredElementHeight";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";
import { useNativeKeyboardHeight } from "@/hooks/useNativeKeyboardHeight";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Send, Loader2, Flame, Search, CalendarPlus } from "lucide-react";
import { ChatBackButton } from "@/components/chat/ChatBackButton";
import { useSwipeBack } from "@/hooks/useSwipeBack";
import { PageLoading } from "@/components/ui/page-loading";
import { ChatHeaderMenu } from "@/components/chat/ChatHeaderMenu";
import { jumpToMessageInVirtualizedChat } from "@/lib/jumpToMessage";
import { ChatSearchBar, ChatSearchLoadingState } from "@/components/chat/ChatSearch";
import { useChatHistorySearch } from "@/hooks/useChatHistorySearch";
import { searchChatHistory } from "@/lib/searchChatHistory";
import { ChatHeaderShell } from "@/components/chat/ChatHeaderShell";
import { ChatDetailsSheet } from "@/components/chat/ChatDetailsSheet";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { markChatScopeNotificationsRead } from "@/lib/markChatScopeRead";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO, isSameDay } from "date-fns";
import { ChatDateSeparator } from "@/components/chat/ChatDateSeparator";
import { MentionInput } from "@/components/chat/MentionInput";
import { ChatComposerShell } from "@/components/chat/ChatComposerShell";
import { ChatImageInput } from "@/components/chat/ChatImageInput";
import { ReplyPreview } from "@/components/chat/ReplyPreview";
import { EditingBanner } from "@/components/chat/EditingBanner";
import { ChatSendButton } from "@/components/chat/ChatSendButton";
import { ScheduleMessageDialog } from "@/components/chat/ScheduleMessageDialog";
import { ScheduledMessagesBanner } from "@/components/chat/ScheduledMessagesBanner";
import type { ScheduleTarget } from "@/hooks/useScheduledMessages";
import { EventPickerSheet } from "@/components/chat/EventPickerSheet";
import { BoardPickerSheet } from "@/components/chat/BoardPickerSheet";
import { CreatePollDialog } from "@/components/chat/CreatePollDialog";
import { PollAttachmentPreview } from "@/components/chat/PollAttachmentPreview";

const BROADCAST_CHAT_ID = "00000000-0000-0000-0000-000000000000";

import { ChatMessage } from "@/components/chat/ChatMessage";
import { shouldGroupWithPrev } from "@/lib/chatGrouping";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";

import { useMessageReads } from "@/hooks/useMessageReads";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { queueMessage, getQueuedMessagesForTarget } from "@/lib/messageQueue";
import { getCachedMessages, cacheMessages, addMessageToCache, shouldRefetchMessages } from "@/lib/messageCache";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { Capacitor } from "@capacitor/core";
import { useNotificationNudge } from "@/hooks/useNotificationNudge";
import { NotificationNudgeBanner } from "@/components/NotificationNudgeBanner";
import { noteChatMount, noteChatUnmount, noteChannelSubscribed, noteChannelRemoved } from "@/lib/chatPerfDiagnostics";


const MESSAGES_PER_PAGE = 30;

interface Message {
  id: string;
  author_id: string;
  text: string;
  image_url: string | null;
  reply_to_id: string | null;
  created_at: string;
  reactions: {
    id: string;
    user_id: string;
    reaction_type: string;
  }[];
  reply_to?: {
    text: string;
  } | null;
}

const getCachedBroadcastMessages = (): Message[] =>
  getCachedMessages("broadcast", "broadcast").map((cachedMessage) => ({
    id: cachedMessage.id,
    author_id: cachedMessage.author_id,
    text: cachedMessage.text,
    image_url: cachedMessage.image_url,
    reply_to_id: cachedMessage.reply_to_id,
    created_at: cachedMessage.created_at,
    reactions: (cachedMessage.reactions || []).map((reaction) => ({
      id: reaction.id || `cached-${cachedMessage.id}-${reaction.user_id}-${reaction.reaction_type}`,
      user_id: reaction.user_id,
      reaction_type: reaction.reaction_type,
    })),
    reply_to: cachedMessage.reply_to ? { text: cachedMessage.reply_to.text } : null,
  }));

export default function BroadcastChatPage() {
  // [chat-perf-diag] track mount/unmount lifetime
  React.useEffect(() => {
    const k = noteChatMount("Broadcast", null);
    return () => noteChatUnmount("Broadcast", k, null);
  }, []);
  const { user, refreshUnreadCount, decrementUnreadCount, initialized } = useAuth();
  const notificationNudge = useNotificationNudge(user?.id, "chat");
  const swipeBack = useSwipeBack();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const authReady = !!user && initialized;
  const [searchParams] = useSearchParams();
  const [message, setMessage, clearDraft] = useChatDraft("broadcast");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const scheduleTarget: ScheduleTarget = { chat_type: "broadcast" };
  const [replyingTo, setReplyingTo] = useState<{ id: string; text: string; authorName: string | null } | null>(null);
  const [editingMessage, setEditingMessage] = useState<{ id: string; text: string } | null>(null);
  const [eventPickerOpen, setEventPickerOpen] = useState(false);
  const [boardPickerOpen, setBoardPickerOpen] = useState(false);
  const [pollDialogOpen, setPollDialogOpen] = useState(false);
  const [pendingPollId, setPendingPollId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const useVirtualizedChat = true;
  // Legacy DOM refs are no longer attached (Virtuoso owns scroll). Kept as
  // null refs for any non-scroll code paths that still pass them around.
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const loadTriggerRef = useRef<HTMLDivElement>(null);
  const virtualHandleRef = useRef<VirtualizedChatMessageListHandle>(null);

  const chatHeight = useChatViewportHeight();
  const isKeyboardOpen = useKeyboardOpen();
  const nativeKbHeight = useNativeKeyboardHeight();
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  const isNativePlatform = Capacitor.isNativePlatform();

  // Mark broadcast notifications as read when opening this thread
  useEffect(() => {
    if (!user) return;
    markChatScopeNotificationsRead({
      userId: user.id,
      scope: { kind: "broadcast" },
      queryClient,
      decrementUnreadCount,
      refreshUnreadCount,
    });
  }, [user, refreshUnreadCount, decrementUnreadCount, queryClient]);
  
  const scrollToBottom = useCallback(() => {
    virtualHandleRef.current?.scrollToBottom("auto");
  }, []);

  const urlMessageId = searchParams.get("message");
  const [liveJump, setLiveJump] = useState<PendingChatJumpPayload | null>(null);
  useEffect(() => subscribePendingChatJump(setLiveJump), []);
  const liveJumpId = liveJump?.kind === "broadcast" ? liveJump.messageId : null;
  const urlJumpNonce = searchParams.get("jump");
  const targetJumpNonce = urlMessageId ? (urlJumpNonce ?? liveJump?.ts) : liveJumpId ? liveJump?.ts : undefined;
  const [fallbackJumpId] = useState(() => consumePendingChatJump("broadcast", null));
  const targetMessageId = urlMessageId ?? liveJumpId ?? fallbackJumpId;
  const targetParentId = searchParams.get("parent");


  // Scroll to and highlight the message referenced by ?message=… (notification deep link).
  // Optional ?parent=… provides a thread fallback if the target reply hasn't loaded yet.
  useEffect(() => {
    if (!targetMessageId) return;
    const cancel = jumpToMessageInVirtualizedChat(
      targetMessageId,
      () => localMessagesRef.current ?? [],
      () => virtualHandleRef.current,
      setHighlightedMessageId,
      {
        tryLoadOlder: () => loadOlderMessagesRef.current?.(),
        parentMessageId: targetParentId ?? undefined,
      },
    );
    return cancel;
  }, [targetMessageId, targetParentId, targetJumpNonce]);

  // Check if user is app admin
  const { data: isAppAdmin } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: authReady,
  });

  const { elementRef: composerRef, height: composerHeight } = useMeasuredElementHeight<HTMLDivElement>(
    [isAppAdmin, replyingTo?.id, editingMessage?.id],
    56,
  );

  const { isOnline } = useOnlineStatus();

  // Force a fresh fetch whenever we land on the broadcast chat. Push
  // notifications and inbox taps can land here while react-query still has
  // stale data — invalidating guarantees the latest message is fetched on entry.
  useEffect(() => {
    if (!authReady) return;
    queryClient.invalidateQueries({ queryKey: ["broadcast-messages"] });
  }, [authReady, queryClient]);

  const { data: messagesData, isLoading } = useQuery({
    queryKey: ["broadcast-messages"],
    queryFn: async () => {
      // If offline, return cached messages using the shared online manager
      // so native app resume does not incorrectly fall back to stale cache.
      if (!isOnline) {
        const cached = getCachedMessages("broadcast", "broadcast");
        if (cached.length > 0) {
          // Transform cached messages to include reactions with proper format
          const messagesWithReactions = cached.map(m => ({
            ...m,
            reactions: (m.reactions || []).map(r => ({ ...r, id: r.id || "" })),
          }));
          return { messages: messagesWithReactions as unknown as Message[], hasOlderMessages: false, fromCache: true };
        }
        throw new Error("No cached messages available offline");
      }

      const { data: rawMessages, error } = await supabase
        .from("broadcast_messages")
        .select("id, text, image_url, created_at, author_id, reply_to_id, deleted_at")
        .is("deleted_at", null) // Only fetch non-deleted messages
        .order("created_at", { ascending: false })
        .limit(MESSAGES_PER_PAGE + 1);

      if (error) throw error;
      
      if (!rawMessages?.length) {
        return { messages: [] as Message[], hasOlderMessages: false };
      }

      const hasMore = rawMessages.length > MESSAGES_PER_PAGE;
      const messagesToDisplay = hasMore ? rawMessages.slice(0, MESSAGES_PER_PAGE) : rawMessages;

      const messageIds = messagesToDisplay.map((m) => m.id);
      const replyToIds = messagesToDisplay
        .filter((m) => m.reply_to_id)
        .map((m) => m.reply_to_id as string);

      // Preserve cached reactions when the reactions query fails transiently
      const cachedQueryData = queryClient.getQueryData(["broadcast-messages"]) as any;
      const cachedMessages: Message[] = Array.isArray(cachedQueryData)
        ? cachedQueryData
        : cachedQueryData?.messages || [];
      const cachedReactionsByMessage = new Map<string, Message["reactions"]>();
      cachedMessages.forEach((cm) => {
        if (cm.reactions?.length) cachedReactionsByMessage.set(cm.id, cm.reactions);
      });

      const [reactionsResult, replyToResult] = await Promise.all([
        supabase
          .from("message_reactions")
          .select("id, user_id, reaction_type, broadcast_message_id")
          .in("broadcast_message_id", messageIds),
        replyToIds.length > 0
          ? supabase
              .from("broadcast_messages")
              .select("id, text")
              .in("id", replyToIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      if (reactionsResult.error) {
        console.warn("[BroadcastChat] Failed to fetch reactions, keeping cached reactions", reactionsResult.error);
      }

      const replyToMap = new Map(
        (replyToResult.data || []).map((r: any) => [r.id, r])
      );

      const messages = messagesToDisplay.map((msg: any) => {
        const replyTo = msg.reply_to_id ? replyToMap.get(msg.reply_to_id) || null : null;
        return {
          id: msg.id,
          author_id: msg.author_id,
          text: msg.text,
          image_url: msg.image_url,
          reply_to_id: msg.reply_to_id,
          created_at: msg.created_at,
          reactions: reactionsResult.error
            ? cachedReactionsByMessage.get(msg.id) || []
            : reactionsResult.data?.filter((r) => r.broadcast_message_id === msg.id) || [],
          reply_to: replyTo,
        };
      }) as Message[];

      // Cache messages for offline access
      cacheMessages("broadcast", "broadcast", messages.map(m => ({
        id: m.id,
        text: m.text,
        author_id: m.author_id,
        created_at: m.created_at,
        image_url: m.image_url,
        reply_to_id: m.reply_to_id,
        profiles: null,
        reactions: m.reactions,
        reply_to: m.reply_to,
      })));

      return { messages, hasOlderMessages: hasMore };
    },
    enabled: !!user?.id, // session token is sufficient; don't wait for profile fetch (`authReady`) to unblock first paint
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    placeholderData: (prev: any) => {
      if (prev) return prev;

      const cachedMessages = getCachedBroadcastMessages();
      if (!cachedMessages.length) return undefined;

      return { messages: cachedMessages, hasOlderMessages: false, fromCache: true };
    },
  });

  // Extract messages and hasOlderMessages from query data
  const messages = useMemo(() => {
    if (!messagesData) return undefined;
    const msgList = Array.isArray(messagesData) 
      ? messagesData 
      : (messagesData as any).messages || [];
    // Sort by created_at to ensure proper ordering
    return [...msgList].sort((a, b) => 
      (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) || a.id.localeCompare(b.id)
    );
  }, [messagesData]);

  // Local copy used for rendering so optimistic updates are instant
  const [localMessages, setLocalMessages] = useState<Message[] | undefined>(() => getCachedBroadcastMessages());
 
  const [infiniteScrollEnabled, setInfiniteScrollEnabled] = useState(false);
  const showLoading =
    (!authReady && !(localMessages?.length)) ||
    (isLoading && !messagesData && !(localMessages?.length));

  // Virtuoso owns initial bottom-pin and reveal; flip the infinite-scroll
  // gate on as soon as we have any messages so older-page loads can begin.
  const isPinned = true;
  useEffect(() => {
    if ((localMessages?.length ?? 0) > 0) setInfiniteScrollEnabled(true);
  }, [localMessages?.length]);

  // Reply/edit composer growth re-pin is handled inside ChatMessagesScroller
  // via the Virtuoso handle (see virtualHandleRef path). No-op here.
 
  // Pull-to-refresh
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  
  const handleRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["broadcast-messages"] });
  }, [queryClient]);

  const handleManualRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    try {
      await handleRefresh();
    } finally {
      setIsManualRefreshing(false);
    }
  }, [handleRefresh]);

  const isAnyRefreshing = isManualRefreshing;

  useLayoutEffect(() => {
    // Sync local render state with query cache without dropping newer optimistic/realtime reactions.
    // Guard: never replace existing messages with an empty array (transient cache state during resume)
    if (!messages || (messages.length === 0 && localMessages && localMessages.length > 0)) return;

    setLocalMessages((prev) => {
      const incomingIds = new Set(messages.map((message) => message.id));
      const realByAuthorText = new Set(
        messages
          .filter((m: any) => !m.id.startsWith("temp-") && !m.id.startsWith("queued-"))
          .map((m: any) => `${m.author_id}::${m.text ?? ""}::${m.image_url ?? ""}`),
      );
      const previousOnly = (prev || []).filter((message: any) => {
        if (incomingIds.has(message.id)) return false;
        if (message.id.startsWith("temp-") || message.id.startsWith("queued-")) {
          const key = `${message.author_id}::${message.text ?? ""}::${message.image_url ?? ""}`;
          if (realByAuthorText.has(key)) return false;
        }
        return true;
      });
      const mergedIncomingMessages = !prev
        ? messages
        : messages.map((message) => {
            const previousMessage = prev.find((item) => item.id === message.id);
            if (!previousMessage) return message;

            const previousReactions = previousMessage.reactions || [];
            const incomingReactions = message.reactions || [];

            const incomingByUser = new Map<string, (typeof incomingReactions)[number]>();
            incomingReactions.forEach((reaction) => {
              incomingByUser.set(reaction.user_id, reaction);
            });

            const incomingIds = new Set(incomingReactions.map((r) => r.id));
            const missingFromIncoming = previousReactions.filter((reaction) => {
              if (incomingIds.has(reaction.id)) return false;
              if (reaction.id.startsWith("temp-")) return !incomingByUser.has(reaction.user_id);
              return !incomingByUser.has(reaction.user_id);
            });

            return {
              ...message,
              reactions: [...incomingReactions, ...missingFromIncoming],
            };
          });
      const mergedMessages = [...previousOnly, ...mergedIncomingMessages].sort((a, b) =>
        (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) || a.id.localeCompare(b.id),
      );

      cacheMessages("broadcast", "broadcast", mergedMessages.map((m) => ({
        id: m.id,
        text: m.text,
        author_id: m.author_id,
        created_at: m.created_at,
        image_url: m.image_url,
        reply_to_id: m.reply_to_id,
        profiles: null,
        reactions: m.reactions,
        reply_to: m.reply_to,
      })));

      return mergedMessages;
    });
  }, [messages]);

  // If messages unexpectedly dropped to 0 but we had cached messages, trigger a refetch
  useEffect(() => {
    if (!authReady || isLoading) return;
    
    const fetchedCount = messages?.length ?? 0;
    if (shouldRefetchMessages("broadcast", "broadcast", fetchedCount)) {
      console.log("[BroadcastChat] Messages unexpectedly 0, triggering refetch");
      queryClient.invalidateQueries({ queryKey: ["broadcast-messages"] });
    }
  }, [authReady, messages, isLoading, queryClient]);

  // Visibility change handler - refetch messages when app becomes visible (e.g., phone unlock)
  useEffect(() => {
    let lastRefresh = Date.now();
    
    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible" && authReady) {
        const timeSinceLastRefresh = Date.now() - lastRefresh;
        // Only refresh if it's been more than 30 seconds
        if (timeSinceLastRefresh > 30000) {
          console.log("[BroadcastChat] App became visible, refreshing messages");
          lastRefresh = Date.now();
          await queryClient.invalidateQueries({ queryKey: ["broadcast-messages"] });
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [authReady, queryClient]);

  useEffect(() => {
    if (messagesData && !Array.isArray(messagesData)) {
      setHasOlderMessages((messagesData as any).hasOlderMessages ?? false);
    }
  }, [messagesData]);

  // Keep a ref to localMessages so loadOlderMessages doesn't churn
  const localMessagesRef = useRef<Message[] | undefined>(localMessages);
  useEffect(() => {
    localMessagesRef.current = localMessages;
  }, [localMessages]);

  // Forward ref so the anchor hook can call the loader defined below.
  const loadOlderMessagesRef = useRef<(() => void) | null>(null);

  // Virtuoso owns scroll-anchoring on prepend natively (firstItemIndex +
  // followOutput). No DOM scrollTop math required — just commit the cache
  // mutation and let Virtuoso preserve the visible window.
  const queueAnchoredPrepend = useCallback((commit: () => void) => commit(), []);

  // Load older messages function with timeout protection
  const loadOlderMessages = useCallback(async () => {
    const currentMessages = localMessagesRef.current;
    if (!currentMessages?.length || isLoadingOlder || !hasOlderMessages) return;

    setIsLoadingOlder(true);

    // Create abort controller for timeout (25s headroom for slow networks)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);
    
    try {
      const oldestMessage = currentMessages[0];
      
      const { data: olderData, error } = await supabase
        .from("broadcast_messages")
        .select("*")
        .is("deleted_at", null)
        .lt("created_at", oldestMessage.created_at)
        .order("created_at", { ascending: false })
        .limit(MESSAGES_PER_PAGE + 1)
        .abortSignal(controller.signal);

      clearTimeout(timeoutId);

      if (error) throw error;
      if (!olderData?.length) {
        setHasOlderMessages(false);
        return;
      }

      const hasMore = olderData.length > MESSAGES_PER_PAGE;
      setHasOlderMessages(hasMore);
      const dataToUse = hasMore ? olderData.slice(0, MESSAGES_PER_PAGE) : olderData;

      // Reverse to get chronological order
      const reversedOlder = [...dataToUse].reverse();
      const messageIds = reversedOlder.map((m) => m.id);
      const replyToIds = reversedOlder.filter((m) => m.reply_to_id).map((m) => m.reply_to_id);

      // Fetch reactions and reply-to messages - don't block on these if slow
      let reactionsData: any[] = [];
      let replyToData: any[] = [];
      
      try {
        const secondaryController = new AbortController();
        const secondaryTimeout = setTimeout(() => secondaryController.abort(), 5000);
        
        const [reactionsResult, replyToResult] = await Promise.all([
          supabase
            .from("message_reactions")
            .select("id, user_id, reaction_type, broadcast_message_id")
            .in("broadcast_message_id", messageIds)
            .abortSignal(secondaryController.signal),
          replyToIds.length > 0
            ? supabase
                .from("broadcast_messages")
                .select("id, text")
                .in("id", replyToIds)
                .abortSignal(secondaryController.signal)
            : Promise.resolve({ data: [] as any[], error: null }),
        ]);
        
        clearTimeout(secondaryTimeout);
        reactionsData = reactionsResult.data || [];
        replyToData = replyToResult.data || [];
      } catch {
        // Continue without reactions/replies if they timeout
      }

      const olderMessages = reversedOlder.map((msg) => ({
        ...msg,
        reactions: reactionsData.filter((r) => r.broadcast_message_id === msg.id) || [],
        reply_to: replyToData.find((r) => r.id === msg.reply_to_id) || null,
      })) as Message[];

      // Prepend + restore scroll anchor synchronously inside flushSync (no jolt).
      queueAnchoredPrepend(() => {
        queryClient.setQueryData(["broadcast-messages"], (old: any) => {
          const existingMessages: Message[] = old?.messages || [];
          return {
            ...(old || {}),
            messages: [...olderMessages, ...existingMessages],
            hasOlderMessages: hasMore,
          };
        });
      });
    } catch (err) {
      clearTimeout(timeoutId);
      console.error('Failed to load older messages:', err);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [queryClient, isLoadingOlder, hasOlderMessages, queueAnchoredPrepend]);

  // Keep the loader ref in sync for the anchor hook to call.
  useEffect(() => {
    loadOlderMessagesRef.current = loadOlderMessages;
  }, [loadOlderMessages]);

  // Realtime subscription - directly update cache instead of invalidating
  useEffect(() => {
    const channel = supabase
      .channel("broadcast-messages-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "broadcast_messages",
        },
        async (payload) => {
          const newMsg = payload.new as any;
          
          // Fetch reply_to data first if needed
          let replyToData = null;
          if (newMsg.reply_to_id) {
            const { data: replyData } = await supabase
              .from("broadcast_messages")
              .select("text, author:profiles!broadcast_messages_author_id_fkey(display_name)")
              .eq("id", newMsg.reply_to_id)
              .single();
            if (replyData) {
              replyToData = {
                text: replyData.text,
                profiles: replyData.author,
              };
            }
          }
          
          const messageWithData: Message = {
            ...newMsg,
            reactions: [],
            reply_to: replyToData,
          };
          
          // Single atomic update - handles both temp replacement and new message addition
          queryClient.setQueryData(["broadcast-messages"], (old: any) => {
            const existingMessages: Message[] = old?.messages || [];
            
            // Check if message already exists with real ID
            if (existingMessages.some(m => m.id === newMsg.id)) {
              return old;
            }
            
            // Check for temp message to replace
            const tempIndex = existingMessages.findIndex(
              m => m.id.startsWith('temp-') && m.author_id === newMsg.author_id
            );
            
            if (tempIndex !== -1) {
              // Replace temp message with real one
              const updatedMessages = [...existingMessages];
              updatedMessages[tempIndex] = {
                ...messageWithData,
                reply_to: messageWithData.reply_to || existingMessages[tempIndex].reply_to,
              };
              return { ...old, messages: updatedMessages };
            }
            
            // Add new message (from other user)
            const updatedMessages = [...existingMessages, messageWithData].sort(
              (a, b) => (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) || a.id.localeCompare(b.id)
            );
            return { ...old, messages: updatedMessages };
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "broadcast_messages",
        },
        (payload) => {
          const deletedId = (payload.old as any).id;
          queryClient.setQueryData(["broadcast-messages"], (old: any) => {
            const existingMessages: Message[] = old?.messages || [];
            return { ...old, messages: existingMessages.filter(m => m.id !== deletedId) };
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "broadcast_messages",
        },
        (payload) => {
          const updated = payload.new as any;
          queryClient.setQueryData(["broadcast-messages"], (old: any) => {
            const existingMessages: Message[] = old?.messages || [];
            // If message was soft-deleted, remove it from the list
            if (updated.deleted_at) {
              return { ...old, messages: existingMessages.filter(m => m.id !== updated.id) };
            }
            // Otherwise update the message content
            return {
              ...old,
              messages: existingMessages.map(m => m.id === updated.id ? { ...m, text: updated.text, image_url: updated.image_url } : m),
            };
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_reactions",
        },
        (payload) => {
          const reaction = payload.new as any;
          if (!reaction.broadcast_message_id) return;
          queryClient.setQueryData(["broadcast-messages"], (old: any) => {
            const existingMessages: Message[] = old?.messages || [];
            const updatedMessages = existingMessages.map(m => {
              if (m.id !== reaction.broadcast_message_id) return m;
              const existingTempIdx = m.reactions.findIndex(
                r => r.id.startsWith('temp-') && r.user_id === reaction.user_id
              );
              if (m.reactions.some(r => r.id === reaction.id)) return m;
              
              const newReaction = { id: reaction.id, user_id: reaction.user_id, reaction_type: reaction.reaction_type };
              if (existingTempIdx !== -1) {
                const newReactions = [...m.reactions];
                newReactions[existingTempIdx] = newReaction;
                return { ...m, reactions: newReactions };
              }
              return { ...m, reactions: [...m.reactions, newReaction] };
            });
            return { ...old, messages: updatedMessages };
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "message_reactions",
        },
        (payload) => {
          const reaction = payload.new as any;
          if (!reaction.broadcast_message_id) return;
          queryClient.setQueryData(["broadcast-messages"], (old: any) => {
            const existingMessages: Message[] = old?.messages || [];
            const updatedMessages = existingMessages.map(m => {
              if (m.id !== reaction.broadcast_message_id) return m;
              const newReaction = { id: reaction.id, user_id: reaction.user_id, reaction_type: reaction.reaction_type };
              const hasExisting = m.reactions.some((r: any) => r.id === reaction.id);
              if (hasExisting) {
                return { ...m, reactions: m.reactions.map((r: any) => r.id === reaction.id ? newReaction : r) };
              }
              return { ...m, reactions: [...m.reactions.filter((r: any) => r.user_id !== reaction.user_id), newReaction] };
            });
            return { ...old, messages: updatedMessages };
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "message_reactions",
        },
        (payload) => {
          const deletedReaction = payload.old as any;
          if (!deletedReaction.id) return;
          queryClient.setQueryData(["broadcast-messages"], (old: any) => {
            const existingMessages: Message[] = old?.messages || [];
            const updatedMessages = existingMessages.map(m => ({
              ...m,
              reactions: m.reactions.filter(r => r.id !== deletedReaction.id)
            }));
            return { ...old, messages: updatedMessages };
          });
        }
      )
      .subscribe();
    noteChannelSubscribed("broadcast-messages-realtime");

    return () => {
      supabase.removeChannel(channel); noteChannelRemoved("broadcast-messages-realtime");
    };
  }, [queryClient]);

  const handleReply = useCallback((m: { id: string; text: string; authorName: string | null }) => {
    // Don't allow replying to optimistic or queued messages (temp/queued IDs)
    if (m.id.startsWith('temp-') || m.id.startsWith('queued-')) {
      toast({ title: "Please wait for the message to be sent before replying", variant: "destructive" });
      return;
    }
    setReplyingTo(m);
    setTimeout(() => virtualHandleRef.current?.scrollToBottom("auto"), 100);
  }, [toast, scrollToBottom]);

  const queryKeyMemo = useMemo(() => ["broadcast-messages"], []);

  const formatTimestamp = useCallback((dateStr: string) => {
    return format(parseISO(dateStr), "MMM d, h:mm a");
  }, []);

  const sendMutation = useMutation({
    mutationFn: async ({ text, image_url, reply_to_id }: { text: string; image_url: string | null; reply_to_id: string | null }) => {
      // If offline, queue the message
      if (!navigator.onLine) {
        queueMessage({
          type: "broadcast",
          targetId: "broadcast", // Broadcast doesn't have a target ID
          authorId: user!.id,
          text,
          imageUrl: image_url,
          replyToId: reply_to_id,
          createdAt: new Date().toISOString(),
        });
        return;
      }
      
      const { error } = await supabase.from("broadcast_messages").insert({
        text,
        author_id: user!.id,
        image_url,
        reply_to_id,
      });
      if (error) throw error;
    },
    onMutate: async ({ text, image_url, reply_to_id }) => {
      await queryClient.cancelQueries({ queryKey: ["broadcast-messages"] });
      const previousData = queryClient.getQueryData(["broadcast-messages"]);

      const optimisticMessage: Message = {
        id: `temp-${Date.now()}`,
        author_id: user!.id,
        text,
        image_url,
        reply_to_id,
        created_at: new Date().toISOString(),
        reactions: [],
        reply_to: replyingTo ? { text: replyingTo.text } : null,
      };

      // Update query cache directly (this will sync to localMessages via useEffect)
      queryClient.setQueryData(["broadcast-messages"], (old: any) => {
        const existingMessages: Message[] = old?.messages || [];
        return {
          ...(old || {}),
          messages: [...existingMessages, optimisticMessage],
        };
      });

      // Clear input immediately
      setMessage("");
      setImageUrl(null);
      setReplyingTo(null);
      setPendingPollId(null);
      
      // Scroll to bottom to show new message
      scrollToBottom();

      return { previousData };
    },
    onError: (err, variables, context) => {
      // Don't revert if offline - message is queued
      if (!navigator.onLine) {
        toast({ title: "Message queued - will send when online" });
        return;
      }
      if (context?.previousData) {
        queryClient.setQueryData(["broadcast-messages"], context.previousData);
      }
      toast({
        title: "Failed to send message",
        variant: "destructive",
      });
    },
    onSettled: () => {
      // Don't invalidate here; realtime will sync messages
    },
   });

  const updateMessageMutation = useMutation({
    mutationFn: async () => {
      if (!editingMessage) return;
      const { error } = await supabase.from("broadcast_messages").update({ text: message.trim() }).eq("id", editingMessage.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setMessage("");
      setEditingMessage(null);
      queryClient.invalidateQueries({ queryKey: queryKeyMemo });
      // silent success
    },
    onError: () => toast({ title: "Failed to update message", variant: "destructive" }),
  });

  const handleSend = () => {
    if (!message.trim() && !imageUrl && !pendingPollId) return;
    if (editingMessage) {
      updateMessageMutation.mutate();
      return;
    }
    const baseText = message.trim();
    const finalText = pendingPollId
      ? (baseText ? `${baseText} [poll:${pendingPollId}]` : `[poll:${pendingPollId}]`)
      : baseText;
    sendMutation.mutate({ text: finalText, image_url: imageUrl, reply_to_id: replyingTo?.id || null });
  };

  const handleEdit = useCallback((msg: { id: string; text: string }) => {
    setEditingMessage(msg);
    setMessage(msg.text);
    setReplyingTo(null);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null);
    setMessage("");
  }, []);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const { isSearching: isSearchFetching, canShowEmpty: searchCanShowEmpty } = useChatHistorySearch<Message>({
    searchQuery,
    loadedMessages: localMessages,
    setMessages: (updater) => setLocalMessages((prev) => updater(prev)),
    enabled: true,
    cacheKey: `broadcast`,
    fetcher: async (q, signal) =>
      (await searchChatHistory({
        table: "broadcast_messages",
        scope: {},
        query: q,
        signal,
        selectColumns: "id, text, image_url, created_at, author_id, reply_to_id",
      })) as Message[],
  });

  const filteredMessages = useMemo(() => {
    if (!localMessages) return localMessages;
    const base = !searchQuery.trim()
      ? localMessages
      : localMessages.filter((msg) =>
          fuzzyMatchesQuery(msg.text, searchQuery)
        );
    return [...base].sort(
      (a, b) => (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) || a.id.localeCompare(b.id)
    );
  }, [localMessages, searchQuery]);

  useEffect(() => {
    if (isSearchFetching) return;
    const firstMatch = searchQuery.trim() ? filteredMessages?.[0] : null;
    if (!firstMatch) return;
    const idx = (filteredMessages ?? []).findIndex((m) => m.id === firstMatch.id);
    if (idx < 0) return;
    requestAnimationFrame(() => virtualHandleRef.current?.scrollToIndex(idx, "center"));
  }, [filteredMessages, isSearchFetching, searchQuery]);

  // Message IDs for read tracking
  const messageIds = useMemo(() => 
    (filteredMessages || []).map(m => m.id).filter(id => !id.startsWith('temp-')),
    [filteredMessages]
  );

  // Read tracking
  const { readCounts, readFrontier, markMessagesAsRead } = useMessageReads(
    "broadcast",
    "broadcast",
    messageIds,
    user?.id
  );

  // Typing indicator (only visible for app admins since they're the only ones who can type)
  const { typingUsers, startTyping, stopTyping } = useTypingIndicator(
    "broadcast",
    user?.id,
    "Announcements"
  );

  // Mark messages as read when they become visible
  // Track messages we've already marked to avoid loops
  const markedAsReadRef = useRef<Set<string>>(new Set());

  // Mark messages as read when they become visible
  useEffect(() => {
    if (!filteredMessages?.length || !user?.id) return;
    
    const messagesToMark = filteredMessages
      .filter(m => m.author_id !== user.id && !m.id.startsWith('temp-') && !markedAsReadRef.current.has(m.id))
      .map(m => m.id);
    
    if (messagesToMark.length > 0) {
      messagesToMark.forEach(id => markedAsReadRef.current.add(id));
      markMessagesAsRead(messagesToMark);
    }
  }, [filteredMessages, user?.id, markMessagesAsRead]);

  if (showLoading) {
    return <PageLoading message="Loading announcements..." />;
  }

  return (
    <div className="flex min-h-0 flex-col overflow-hidden overscroll-none" style={{ height: chatHeight }} data-lock-keyboard-scroll="true" onTouchStart={swipeBack.onTouchStart} onTouchEnd={swipeBack.onTouchEnd}>
      {/* Header */}
      <ChatHeaderShell
        type="broadcast"
        name="Announcements"
        sublabel="Official updates & news"
        onOpenDetails={() => setDetailsOpen(true)}
        leftSlot={
          <ChatSearchBar onSearch={setSearchQuery} isOpen={searchOpen} onOpenChange={setSearchOpen} isSearching={isSearchFetching} />
        }
        rightSlot={
          <>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSearchOpen(true)}>
              <Search className="h-4 w-4" />
            </Button>
            <ChatHeaderMenu onRefresh={handleManualRefresh} isRefreshing={isAnyRefreshing} />
          </>
        }
      />
      <ChatDetailsSheet
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        chatType="broadcast"
        chatId="broadcast"
        name="Announcements"
        sublabel="Official updates & news"
      />

      {/* Notification Nudge */}
      {notificationNudge.shouldShowNudge && (
        <div className="px-4 pt-2 shrink-0">
          <NotificationNudgeBanner
            message="Enable notifications so you never miss broadcasts"
            onDismiss={notificationNudge.dismiss}
            userId={user?.id}
          />
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 min-h-0 py-4 flex flex-col relative overflow-hidden overscroll-none">
        {(isSearchFetching || (!!searchQuery && !searchCanShowEmpty)) ? (
          <ChatSearchLoadingState />
        ) : filteredMessages?.length === 0 ? (
          <ChatEmptyState
            title="No announcements yet"
            isSearchResult={!!searchQuery}
          />
        ) : (
          <ChatMessagesScroller
            messages={filteredMessages || []}
            hasOlderMessages={hasOlderMessages}
            isLoadingOlder={isLoadingOlder}
            onLoadOlder={loadOlderMessages}
            isPinned={isPinned}
            isKeyboardOpen={isKeyboardOpen}
            searchOpen={searchOpen}
            composerHeight={composerHeight}
            currentUserId={user?.id}
            virtualHandleRef={virtualHandleRef}
            initialBottomPinned={!targetMessageId}
            renderRow={(msg, index, arr) => {
              const currentDate = new Date(msg.created_at);
              const prevMessage = index > 0 ? arr[index - 1] : null;
              const nextMessage = index < arr.length - 1 ? arr[index + 1] : null;
              const showDateSeparator = !prevMessage || !isSameDay(currentDate, new Date(prevMessage.created_at));
              const groupedWithPrev = !showDateSeparator && shouldGroupWithPrev(msg, prevMessage);
              const groupedWithNext = nextMessage
                ? isSameDay(currentDate, new Date(nextMessage.created_at)) && shouldGroupWithPrev(nextMessage, msg)
                : false;
              return (
                <>
                  {showDateSeparator && <ChatDateSeparator date={currentDate} />}
                  <div
                    id={`message-${msg.id}`}
                    className={`transition-colors duration-500 ${
                      highlightedMessageId === msg.id ? "bg-primary/10 rounded-lg" : ""
                    }`}
                  >
                    <ChatMessage
                      id={msg.id}
                      text={msg.text}
                      imageUrl={msg.image_url}
                      authorId={msg.author_id}
                      authorName="Announcements"
                      timestamp={formatTimestamp(msg.created_at)}
                      isOwn={msg.author_id === user?.id}
                      isAdmin={isAppAdmin || false}
                      reactions={msg.reactions}
                      currentUserId={user?.id}
                      messageType="broadcast"
                      queryKey={queryKeyMemo}
                      replyToMessage={
                        msg.reply_to
                          ? { text: msg.reply_to.text, authorName: null }
                          : null
                      }
                      hasReply={!!msg.reply_to_id}
                      onReply={isAppAdmin ? handleReply : undefined}
                      onEdit={handleEdit}
                      searchQuery={searchQuery}
                      readFrontierReaders={readFrontier[msg.id] || []}
                      readCount={readCounts[msg.id] || 0}
                      isLastMessage={index === arr.length - 1}
                      isPending={msg.id.startsWith("queued-")}
                      contextId="broadcast"
                      groupedWithPrev={groupedWithPrev}
                      groupedWithNext={groupedWithNext}
                    />
                  </div>
                </>
              );
            }}
          />
        )}
      </div>

      {/* Input (only for app admins) */}
      {isAppAdmin && (
        <>
        <div className={`fixed left-0 right-0 bg-background z-[49] pointer-events-none ${searchOpen ? "hidden" : ""}`} style={{ bottom: nativeKbHeight, height: nativeKbHeight > 0 ? "3rem" : "calc(var(--bottom-nav-offset, 0px) + 3rem)" }} />
        <div ref={composerRef} data-chat-chrome="true" className={`fixed left-0 right-0 w-full max-w-full overflow-visible border-t border-border/30 pt-1 pb-2 px-2 bg-background/95 z-[51] ${searchOpen ? "hidden" : ""}`} style={{ bottom: nativeKbHeight > 0 ? nativeKbHeight : "var(--bottom-nav-offset, 0px)" }}>
          <TypingIndicator typingUsers={typingUsers} />
          <ReplyPreview replyingTo={replyingTo} onCancel={() => setReplyingTo(null)} />
          {editingMessage && <EditingBanner text={editingMessage.text} onCancel={handleCancelEdit} />}
          {pendingPollId && !editingMessage && (
            <PollAttachmentPreview
              pollId={pendingPollId}
              onRemove={() => setPendingPollId(null)}
              disabled={sendMutation.isPending}
            />
          )}
          <ScheduledMessagesBanner target={scheduleTarget} />
          <ChatComposerShell>
            <ChatImageInput
              imageUrl={imageUrl}
              onImageUploaded={setImageUrl}
              disabled={false}
              showPollCreator={true}
              onPollCreate={() => setPollDialogOpen(true)}
              showBoardPicker={false}
              onBoardPick={() => setBoardPickerOpen(true)}
              hasText={!!message.trim()}
            />
            <MentionInput
              bare
              placeholder="Type a message..."
              value={message}
              onChange={(val) => {
                setMessage(val);
                if (val.trim()) startTyping();
                else stopTyping();
              }}
              onKeyPress={handleKeyPress}
              disabled={false}
              disableMentions
              onGifSelect={setImageUrl}
            />
            <ChatSendButton
              onSend={() => {
                stopTyping();
                handleSend();
              }}
              onSchedule={() => setScheduleDialogOpen(true)}
              disabled={!message.trim() && !imageUrl && !pendingPollId}
              loading={sendMutation.isPending}
              canSend={!!message.trim() || !!imageUrl || !!pendingPollId}
            />
          </ChatComposerShell>
          <ScheduleMessageDialog
            open={scheduleDialogOpen}
            onOpenChange={setScheduleDialogOpen}
            target={scheduleTarget}
            initialText={message}
            initialImageUrl={imageUrl}
            onScheduled={() => {
              setMessage("");
              setImageUrl(null);
              clearDraft?.();
            }}
          />
          <CreatePollDialog
            open={pollDialogOpen}
            onOpenChange={setPollDialogOpen}
            chatType="broadcast"
            chatId={BROADCAST_CHAT_ID}
            onCreated={(pollId) => setPendingPollId(pollId)}
          />
          <BoardPickerSheet
            open={boardPickerOpen}
            onOpenChange={setBoardPickerOpen}
            onSelectBoard={(gameId) => {
              const token = `[board:${gameId}]`;
              setMessage(message ? `${message} ${token}` : token);
            }}
          />
        </div>
        </>
      )}
    </div>
  );
}
