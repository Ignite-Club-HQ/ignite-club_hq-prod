import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Send, Loader2, Flame } from "lucide-react";
import { PageLoading } from "@/components/ui/page-loading";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { ChatHeaderMenu } from "@/components/chat/ChatHeaderMenu";
import { ChatSearchBar } from "@/components/chat/ChatSearch";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO, isSameDay } from "date-fns";
import { ChatDateSeparator } from "@/components/chat/ChatDateSeparator";
import { MentionInput } from "@/components/chat/MentionInput";
import { ChatImageInput } from "@/components/chat/ChatImageInput";
import { ReplyPreview } from "@/components/chat/ReplyPreview";

import { ChatMessage } from "@/components/chat/ChatMessage";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";

import { useMessageReads } from "@/hooks/useMessageReads";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { queueMessage, getQueuedMessagesForTarget } from "@/lib/messageQueue";
import { getCachedMessages, cacheMessages, addMessageToCache, shouldRefetchMessages } from "@/lib/messageCache";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { Capacitor } from "@capacitor/core";

const MESSAGES_PER_PAGE = 15;

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

export default function BroadcastChatPage() {
  const { user, refreshUnreadCount } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [message, setMessage] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<{ id: string; text: string; authorName: string | null } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const loadTriggerRef = useRef<HTMLDivElement>(null);
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  const isNativePlatform = Capacitor.isNativePlatform();

  // Mark broadcast notifications as read when opening this thread
  useEffect(() => {
    if (!user) return;
    
    const markNotificationsAsRead = async () => {
      await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", user.id)
        .eq("type", "broadcast")
        .eq("is_read", false);
      
      // Refresh unread counts
      refreshUnreadCount();
      queryClient.invalidateQueries({ queryKey: ["unread-message-counts"] });
    };
    
    markNotificationsAsRead();
  }, [user, refreshUnreadCount, queryClient]);
  
  // Scroll to bottom helper - retries until content is ready
  const scrollToBottom = useCallback(() => {
    if (!scrollAreaRef.current) return;
    
    const el = scrollAreaRef.current;
    const doScroll = () => {
      if (el.scrollHeight > el.clientHeight) {
        el.scrollTop = el.scrollHeight;
      }
    };
    
    doScroll();
    setTimeout(doScroll, 50);
    setTimeout(doScroll, 150);
    setTimeout(doScroll, 300);
    setTimeout(doScroll, 500);
  }, []);
  
  const targetMessageId = searchParams.get("message");

  // Set highlighted message from URL param
  useEffect(() => {
    if (targetMessageId) {
      setHighlightedMessageId(targetMessageId);
      const timer = setTimeout(() => setHighlightedMessageId(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [targetMessageId]);

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
    enabled: !!user,
  });

  const { isOnline } = useOnlineStatus();

  const { data: messagesData, isLoading } = useQuery({
    queryKey: ["broadcast-messages"],
    queryFn: async () => {
      // If offline, return cached messages
      if (!navigator.onLine) {
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
          reactions: reactionsResult.data?.filter((r) => r.broadcast_message_id === msg.id) || [],
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
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const showLoading = isLoading && !messagesData;

  // Extract messages and hasOlderMessages from query data
  const messages = useMemo(() => {
    if (!messagesData) return undefined;
    const msgList = Array.isArray(messagesData) 
      ? messagesData 
      : (messagesData as any).messages || [];
    // Sort by created_at to ensure proper ordering
    return [...msgList].sort((a, b) => 
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }, [messagesData]);

  // Local copy used for rendering so optimistic updates are instant
  const [localMessages, setLocalMessages] = useState<Message[] | undefined>(undefined);
 
  // Track if initial scroll has happened
  const hasInitialScrolled = useRef(false);
  const [infiniteScrollEnabled, setInfiniteScrollEnabled] = useState(false);
  
  // Reset initial scroll state on mount (broadcast is always the same chat, but ensure reset on navigation)
  useEffect(() => {
    hasInitialScrolled.current = false;
    setInfiniteScrollEnabled(false);
  }, []);
 
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

  const { containerRef: pullRefreshRef, isRefreshing, pullDistance, pullProgress } = usePullToRefresh({
    onRefresh: handleRefresh,
    disabled: isLoading,
    scrollableRef: scrollAreaRef,
  });
  
  const isAnyRefreshing = isRefreshing || isManualRefreshing;

  useEffect(() => {
    // Always sync localMessages with messages from query cache
    // This ensures optimistic updates (deletions, edits) are reflected immediately
    if (messages) {
      setLocalMessages(messages);
    }
  }, [messages]);

  // If messages unexpectedly dropped to 0 but we had cached messages, trigger a refetch
  useEffect(() => {
    if (isLoading) return;
    
    const fetchedCount = messages?.length ?? 0;
    if (shouldRefetchMessages("broadcast", "broadcast", fetchedCount)) {
      console.log("[BroadcastChat] Messages unexpectedly 0, triggering refetch");
      queryClient.invalidateQueries({ queryKey: ["broadcast-messages"] });
    }
  }, [messages, isLoading, queryClient]);

  // Visibility change handler - refetch messages when app becomes visible (e.g., phone unlock)
  useEffect(() => {
    let lastRefresh = Date.now();
    
    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible") {
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
  }, [queryClient]);

  // Scroll to bottom on initial load - wait for content to render
  useEffect(() => {
    if (!localMessages?.length || hasInitialScrolled.current) return;
    
    const timer = setTimeout(() => {
      hasInitialScrolled.current = true;
      setInfiniteScrollEnabled(true);
      scrollToBottom();
    }, 200);
    
    return () => clearTimeout(timer);
  }, [localMessages, scrollToBottom]);

  useEffect(() => {
    if (messagesData && !Array.isArray(messagesData)) {
      setHasOlderMessages((messagesData as any).hasOlderMessages ?? false);
    }
  }, [messagesData]);

  // Load older messages function with timeout protection
  const loadOlderMessages = useCallback(async () => {
    if (!localMessages?.length || isLoadingOlder || !hasOlderMessages) return;

    setIsLoadingOlder(true);
    const firstVisibleMessageId = localMessages[0].id;
    
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    try {
      const oldestMessage = localMessages[0];
      
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

      // Prepend older messages to cache (preserve object shape with messages + hasOlderMessages)
      queryClient.setQueryData(["broadcast-messages"], (old: any) => {
        const existingMessages: Message[] = old?.messages || [];
        return {
          ...(old || {}),
          messages: [...olderMessages, ...existingMessages],
          hasOlderMessages: hasMore,
        };
      });

      // Scroll to the first previously visible message after DOM updates
      setTimeout(() => {
        const element = document.getElementById(`message-${firstVisibleMessageId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'instant', block: 'start' });
        }
      }, 50);
    } catch (err) {
      clearTimeout(timeoutId);
      console.error('Failed to load older messages:', err);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [localMessages, queryClient, isLoadingOlder, hasOlderMessages]);

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (!infiniteScrollEnabled || !loadTriggerRef.current || !hasOlderMessages || searchQuery) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingOlder && hasOlderMessages) {
          loadOlderMessages();
        }
      },
      { threshold: 0.1 }
    );
    
    observer.observe(loadTriggerRef.current);
    return () => observer.disconnect();
  }, [loadOlderMessages, isLoadingOlder, hasOlderMessages, searchQuery, infiniteScrollEnabled]);

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
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
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

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const handleReply = useCallback((m: { id: string; text: string; authorName: string | null }) => {
    // Don't allow replying to optimistic or queued messages (temp/queued IDs)
    if (m.id.startsWith('temp-') || m.id.startsWith('queued-')) {
      toast({ title: "Please wait for the message to be sent before replying", variant: "destructive" });
      return;
    }
    setReplyingTo(m);
  }, [toast]);

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

  const handleSend = () => {
    if (!message.trim() && !imageUrl) return;
    sendMutation.mutate({ text: message.trim(), image_url: imageUrl, reply_to_id: replyingTo?.id || null });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const filteredMessages = useMemo(() => {
    if (!localMessages) return localMessages;
    const base = !searchQuery.trim()
      ? localMessages
      : localMessages.filter((msg) =>
          msg.text.toLowerCase().includes(searchQuery.toLowerCase())
        );
    return [...base].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }, [localMessages, searchQuery]);

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
    <div className="flex flex-col h-[calc(100dvh-4rem)] pb-[calc(5rem+env(safe-area-inset-bottom,0px))] overflow-hidden overscroll-none">
      {/* Header */}
      <div className="flex items-center gap-3 py-4 border-b bg-background sticky top-0 z-10 shrink-0 relative">
        <ChatSearchBar onSearch={setSearchQuery} isOpen={searchOpen} onOpenChange={setSearchOpen} />
        <Button variant="ghost" size="icon" onClick={() => navigate("/messages")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="p-1.5 rounded-lg" style={{ backgroundColor: 'hsl(142, 71%, 45%)' }}>
          <Flame className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold truncate">Announcements</h1>
          <p className="text-sm text-muted-foreground truncate">Official updates & news</p>
        </div>
        <div className="flex items-center shrink-0">
          <ChatHeaderMenu
            chatType="club"
            chatId="broadcast"
            onSearchOpen={() => setSearchOpen(true)}
            showMembers={false}
            showMute={false}
            onRefresh={handleManualRefresh}
            isRefreshing={isAnyRefreshing}
            isNativePlatform={isNativePlatform}
          />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 py-4 flex flex-col relative overflow-hidden overscroll-none">
        {filteredMessages?.length === 0 ? (
          <ChatEmptyState
            title="No announcements yet"
            isSearchResult={!!searchQuery}
          />
        ) : (
          <div
            className="flex-1 min-h-0 overflow-y-auto overscroll-none scrollbar-hide"
            ref={scrollAreaRef}
            style={{ WebkitOverflowScrolling: isNativeIOS ? 'auto' : 'touch' }}
          >
            <div className="space-y-4 pt-4 pr-4 pb-20">
              {/* Invisible trigger for infinite scroll */}
              {hasOlderMessages && !searchQuery && (
                <div ref={loadTriggerRef} className="flex justify-center py-2">
                  {isLoadingOlder && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </div>
              )}
              {(filteredMessages || []).map((msg, index, arr) => {
                const currentDate = new Date(msg.created_at);
                const prevMessage = index > 0 ? arr[index - 1] : null;
                const showDateSeparator = !prevMessage || !isSameDay(currentDate, new Date(prevMessage.created_at));
                
                return (
                  <div key={msg.id}>
                    {showDateSeparator && <ChatDateSeparator date={currentDate} />}
                    <div
                      className={`transition-colors duration-500 ${
                        highlightedMessageId === msg.id
                          ? "bg-primary/20 ring-2 ring-primary ring-offset-2 ring-offset-background rounded-lg p-2"
                          : ""
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
                        onReply={isAppAdmin ? handleReply : undefined}
                        searchQuery={searchQuery}
                        readFrontierReaders={readFrontier[msg.id] || []}
                        readCount={readCounts[msg.id] || 0}
                        isLastMessage={index === filteredMessages.length - 1}
                        isPending={msg.id.startsWith("queued-")}
                      />
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          </div>
        )}
      </div>

      {/* Input (only for app admins) */}
      {isAppAdmin && (
        <div className="border-t py-4">
          <TypingIndicator typingUsers={typingUsers} />
          <ReplyPreview replyingTo={replyingTo} onCancel={() => setReplyingTo(null)} />
          <div className="flex gap-2 items-end">
            <ChatImageInput
              imageUrl={imageUrl}
              onImageUploaded={setImageUrl}
              disabled={sendMutation.isPending}
            />
            <MentionInput
              placeholder="Send announcement to all users..."
              value={message}
              onChange={(val) => {
                setMessage(val);
                if (val.trim()) startTyping();
                else stopTyping();
              }}
              onKeyPress={handleKeyPress}
              disabled={sendMutation.isPending}
            />
            <Button
              size="icon"
              onClick={() => {
                stopTyping();
                handleSend();
              }}
              disabled={(!message.trim() && !imageUrl) || sendMutation.isPending}
            >
              {sendMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Contact support@ignuteclubhq.app for technical enquiries
          </p>
        </div>
      )}
    </div>
  );
}
