import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Send, Loader2, Crown, Lock, Flame } from "lucide-react";
import { PageLoading } from "@/components/ui/page-loading";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { PullToRefreshIndicator } from "@/components/chat/PullToRefreshIndicator";
import { ChatRefreshButton } from "@/components/chat/ChatRefreshButton";

import { toast } from "sonner";
import { ReplyPreview } from "@/components/chat/ReplyPreview";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { MentionInput } from "@/components/chat/MentionInput";
import { format, isSameDay } from "date-fns";
import { ChatDateSeparator } from "@/components/chat/ChatDateSeparator";
import { fetchProfilesWithCache } from "@/lib/profileCache";
import { useProfiles } from "@/hooks/useProfiles";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getCachedMessages, cacheMessages, CachedMessage } from "@/lib/messageCache";
import { ChatSearch, highlightText } from "@/components/chat/ChatSearch";
import { ChatMuteButton } from "@/components/chat/ChatMuteButton";
import { IGNITE_SUPPORT_USER_ID, isIgniteSupportUser } from "@/lib/systemUser";
import { useMessageReads } from "@/hooks/useMessageReads";
import { Capacitor } from "@capacitor/core";

const MESSAGES_PER_PAGE = 15;

interface DirectMessage {
  id: string;
  text: string;
  image_url: string | null;
  created_at: string;
  author_id: string;
  conversation_id: string;
  reply_to_id: string | null;
  author?: {
    display_name: string | null;
    avatar_url: string | null;
  };
  reply_to?: {
    text: string;
    author?: {
      display_name: string | null;
    };
  } | null;
  reactions?: {
    id: string;
    user_id: string;
    reaction_type: string;
  }[];
}

interface DirectConversation {
  id: string;
  participant_1: string;
  participant_2: string;
  created_at: string;
  updated_at: string;
}
export default function DirectMessagePage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [replyTo, setReplyTo] = useState<DirectMessage | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const profileRef = useRef(profile);
  profileRef.current = profile;
  const replyToRef = useRef(replyTo);
  replyToRef.current = replyTo;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  
  const scrollToBottom = useCallback(() => {
    if (!scrollAreaRef.current) return;
    scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
  }, []);
  
  const targetMessageId = searchParams.get("message");

  useEffect(() => {
    if (targetMessageId) {
      setHighlightedMessageId(targetMessageId);
      const timer = setTimeout(() => setHighlightedMessageId(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [targetMessageId]);

  // Fetch conversation details
  const { data: conversation, isLoading: conversationLoading } = useQuery({
    queryKey: ["dm-conversation", conversationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("direct_conversations")
        .select("*")
        .eq("id", conversationId)
        .single();
      if (error) throw error;
      return data as DirectConversation;
    },
    enabled: !!conversationId,
    staleTime: 5 * 60 * 1000,
  });

  // Get the other participant's ID
  const otherUserId = conversation 
    ? (conversation.participant_1 === user?.id ? conversation.participant_2 : conversation.participant_1)
    : null;

  // Check if this is a conversation with Ignite Support (system user)
  const isIgniteSupportConversation = isIgniteSupportUser(otherUserId);

  // Fetch other participant's profile
  const { data: otherUser } = useQuery({
    queryKey: ["dm-other-user", otherUserId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .eq("id", otherUserId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!otherUserId,
    staleTime: 5 * 60 * 1000,
  });

  // Check if DM is allowed (both users in Pro club) - skip for Ignite Support
  const { data: canDM, isLoading: checkingCanDM } = useQuery({
    queryKey: ["can-dm", otherUserId],
    queryFn: async () => {
      if (!otherUserId) return false;
      // Always allow DMs with Ignite Support
      if (isIgniteSupportUser(otherUserId)) return true;
      
      const { data, error } = await supabase.rpc("can_dm_user", { other_user_id: otherUserId });
      if (error) {
        console.error("can_dm_user error:", error);
        // If RPC fails, don't block - they may have an existing conversation
        return true;
      }
      return data as boolean;
    },
    enabled: !!otherUserId,
    staleTime: 30 * 1000, // Shorter stale time - 30 seconds
    refetchOnMount: true, // Always re-check when returning to page
  });

  // Fetch messages with cache support
  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ["dm-messages", conversationId],
    queryFn: async () => {
      const { data: rawMessages, error } = await supabase
        .from("direct_messages")
        .select("id, text, image_url, created_at, author_id, conversation_id, reply_to_id, deleted_at")
        .eq("conversation_id", conversationId)
        .is("deleted_at", null) // Only fetch non-deleted messages
        .order("created_at", { ascending: false })
        .limit(MESSAGES_PER_PAGE + 1);
      if (error) throw error;
      
      if (!rawMessages?.length) {
        return { messages: [] as DirectMessage[], hasOlderMessages: false };
      }
      
      const hasMore = rawMessages.length > MESSAGES_PER_PAGE;
      const dataToDisplay = hasMore ? rawMessages.slice(0, MESSAGES_PER_PAGE) : rawMessages;
      
      const messageIds = dataToDisplay.map((m) => m.id);
      const replyToIds = dataToDisplay.filter((m) => m.reply_to_id).map((m) => m.reply_to_id as string);
      const authorIds = [...new Set(dataToDisplay.map((m) => m.author_id))];

      const [reactionsResult, replyToResult, profilesMap] = await Promise.all([
        supabase
          .from("message_reactions")
          .select("id, user_id, reaction_type, direct_message_id")
          .in("direct_message_id", messageIds),
        replyToIds.length > 0
          ? supabase
              .from("direct_messages")
              .select("id, text, author_id")
              .in("id", replyToIds)
          : Promise.resolve({ data: [] as any[] }),
        fetchProfilesWithCache(authorIds),
      ]);

      const replyToMap = new Map(
        (replyToResult.data || []).map((r: any) => [r.id, {
          ...r,
          author: profilesMap.get(r.author_id) ? { display_name: profilesMap.get(r.author_id)?.display_name } : null,
        }])
      );

      const messages = dataToDisplay.map((msg: any) => {
        const replyTo = msg.reply_to_id ? replyToMap.get(msg.reply_to_id) || null : null;
        const profile = profilesMap.get(msg.author_id);
        const msgReactions = (reactionsResult.data || [])
          .filter((r: any) => r.direct_message_id === msg.id)
          .map((r: any) => ({ id: r.id, user_id: r.user_id, reaction_type: r.reaction_type }));
        return {
          ...msg,
          author: profile ? { display_name: profile.display_name, avatar_url: profile.avatar_url } : null,
          reply_to: replyTo,
          reactions: msgReactions,
        };
      }) as DirectMessage[];
      
      // Cache messages for offline/fast reload
      const messagesToCache: CachedMessage[] = messages.map(m => ({
        id: m.id,
        text: m.text,
        author_id: m.author_id,
        created_at: m.created_at,
        image_url: m.image_url,
        reply_to_id: m.reply_to_id,
        profiles: m.author ? { display_name: m.author.display_name, avatar_url: m.author.avatar_url } : null,
        reactions: m.reactions || [],
        reply_to: m.reply_to ? { text: m.reply_to.text, author: m.reply_to.author } : null,
      }));
      cacheMessages("dm", conversationId!, messagesToCache);
      
      return {
        messages,
        hasOlderMessages: hasMore,
      };
    },
    enabled: !!conversationId,
    staleTime: 30 * 1000, // 30 seconds - shorter stale time to ensure fresh data
    refetchOnMount: 'always', // Always refetch when returning to page
    refetchOnWindowFocus: false,
    placeholderData: () => {
      // Return cached messages as placeholder for instant load
      if (!conversationId) return undefined;
      const cached = getCachedMessages("dm", conversationId);
      if (!cached.length) return undefined;
      
      const messages: DirectMessage[] = cached.map(c => ({
        id: c.id,
        text: c.text,
        image_url: c.image_url,
        created_at: c.created_at,
        author_id: c.author_id,
        conversation_id: conversationId,
        reply_to_id: c.reply_to_id,
        author: c.profiles ? { display_name: c.profiles.display_name, avatar_url: c.profiles.avatar_url } : undefined,
        reply_to: c.reply_to ? { text: c.reply_to.text, author: c.reply_to.author || c.reply_to.profiles } : null,
        reactions: (c.reactions || []).map((r: any) => ({
          id: r.id || "",
          user_id: r.user_id,
          reaction_type: r.reaction_type,
        })),
      }));
      
      return { messages, hasOlderMessages: false };
    },
  });

  const showLoading = messagesLoading && !messagesData;

  const messages = useMemo(() => {
    if (!messagesData) return [];
    const msgList = Array.isArray(messagesData) 
      ? messagesData 
      : (messagesData as any).messages || [];
    return [...msgList].sort((a, b) => 
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }, [messagesData]);

  const [localMessages, setLocalMessages] = useState<DirectMessage[] | undefined>(undefined);
  const localMessagesRef = useRef(localMessages);
  localMessagesRef.current = localMessages;
  const hasInitialScrolled = useRef(false);
  const [infiniteScrollEnabled, setInfiniteScrollEnabled] = useState(false);
  
  // Use fresh profile data that refreshes on visibility change (fixes names vanishing after phone lock)
  const authorIds = useMemo(() => {
    return [...new Set((localMessages || []).map(m => m.author_id).filter(Boolean))];
  }, [localMessages]);
  const { getProfile } = useProfiles(authorIds);

  // Read tracking for DMs
  const messageIds = useMemo(() => (localMessages || []).map(m => m.id).filter(id => !id.startsWith("temp-")), [localMessages]);
  const { readCounts, readFrontier, markMessagesAsRead } = useMessageReads("dm", conversationId || "", messageIds, user?.id);

  // Mark visible messages as read when they appear
  useEffect(() => {
    if (!localMessages?.length || !user?.id) return;
    const otherUserMessages = localMessages
      .filter(m => m.author_id !== user.id && !m.id.startsWith("temp-"))
      .map(m => m.id);
    if (otherUserMessages.length > 0) {
      markMessagesAsRead(otherUserMessages);
    }
  }, [localMessages, user?.id, markMessagesAsRead]);
  useEffect(() => {
    hasInitialScrolled.current = false;
    setInfiniteScrollEnabled(false);
  }, [conversationId]);
 
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  
  const handleRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["dm-messages", conversationId] });
  }, [queryClient, conversationId]);

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
    disabled: messagesLoading,
    scrollableRef: scrollAreaRef,
  });
  
  const isAnyRefreshing = isRefreshing || isManualRefreshing;

  // Sync localMessages with fetched messages
  // Always update when we have fresh data (even if empty) to avoid stale optimistic messages
  useEffect(() => {
    if (messages) {
      // If we have messages from the server, use them
      if (messages.length > 0) {
        setLocalMessages(messages);
      } else {
        // Only clear local messages if the query is not using placeholder data
        // This prevents clearing optimistic updates during initial fetch
        if (!messagesLoading) {
          setLocalMessages(messages);
        }
      }
    }
  }, [messages, messagesLoading]);

  useEffect(() => {
    if (!localMessages?.length) return;
    if (hasInitialScrolled.current) return;
    
    let attempts = 0;
    const maxAttempts = 20;
    
    const tryScroll = () => {
      attempts++;
      if (!scrollAreaRef.current) {
        if (attempts < maxAttempts) setTimeout(tryScroll, 100);
        return;
      }
      const el = scrollAreaRef.current;
      hasInitialScrolled.current = true;
      setInfiniteScrollEnabled(true);
      el.scrollTop = el.scrollHeight;
      setTimeout(() => { el.scrollTop = el.scrollHeight; }, 50);
      setTimeout(() => { el.scrollTop = el.scrollHeight; }, 150);
    };
    tryScroll();
  }, [localMessages]);

  useEffect(() => {
    if (messagesData && !Array.isArray(messagesData)) {
      setHasOlderMessages((messagesData as any).hasOlderMessages ?? false);
    }
  }, [messagesData]);

  // Visibility change handler - refetch messages and profiles when app becomes visible (e.g., phone unlock)
  useEffect(() => {
    let lastRefresh = Date.now();
    
    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible" && conversationId) {
        const timeSinceLastRefresh = Date.now() - lastRefresh;
        // Only refresh if it's been more than 30 seconds
        if (timeSinceLastRefresh > 30000) {
          console.log("[DirectMessage] App became visible, refreshing messages");
          lastRefresh = Date.now();
          await queryClient.invalidateQueries({ queryKey: ["dm-messages", conversationId] });
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [conversationId, queryClient]);

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ text, imageUrl, replyToId }: { text: string; imageUrl?: string | null; replyToId?: string | null }) => {
      const { data, error } = await supabase
        .from("direct_messages")
        .insert({
          conversation_id: conversationId!,
          author_id: user!.id,
          text,
          image_url: imageUrl || null,
          reply_to_id: replyToId || null, // Ensure empty string becomes null for UUID column
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onMutate: async ({ text, imageUrl, replyToId }) => {
      const optimisticMessage: DirectMessage = {
        id: `temp-${Date.now()}`,
        text,
        image_url: imageUrl || null,
        created_at: new Date().toISOString(),
        author_id: user!.id,
        conversation_id: conversationId!,
        reply_to_id: replyToId || null,
        author: {
          display_name: profileRef.current?.display_name || null,
          avatar_url: profileRef.current?.avatar_url || null,
        },
        reply_to: replyToId && replyTo ? { text: replyTo.text, author: replyTo.author } : null,
      };
      setLocalMessages((prev) => [...(prev || []), optimisticMessage]);
      setTimeout(scrollToBottom, 50);
    },
    onSuccess: async (newMessage) => {
      const currentReplyTo = replyToRef.current;
      
      // Update the query cache with the new message to replace optimistic one
      queryClient.setQueryData(
        ["dm-messages", conversationId],
        (oldData: { messages: DirectMessage[]; hasOlderMessages: boolean } | undefined) => {
          if (!oldData) {
            const msg: DirectMessage = {
              ...newMessage,
              author: {
                display_name: profileRef.current?.display_name || null,
                avatar_url: profileRef.current?.avatar_url || null,
              },
              reactions: [],
              reply_to: currentReplyTo ? { text: currentReplyTo.text, author: currentReplyTo.author } : null,
            };
            return { messages: [msg], hasOlderMessages: false };
          }
          
          // Replace optimistic message with real one
          const updatedMessages = oldData.messages
            .filter((m) => !m.id.startsWith("temp-"))
            .concat({
              ...newMessage,
              author: {
                display_name: profileRef.current?.display_name || null,
                avatar_url: profileRef.current?.avatar_url || null,
              },
              reactions: [],
              reply_to: currentReplyTo ? { text: currentReplyTo.text, author: currentReplyTo.author } : null,
            });
          
          return { ...oldData, messages: updatedMessages };
        }
      );
      
      // Also update the local message cache for offline/fast reload
      const currentMessages = localMessagesRef.current || [];
      const realMessages = currentMessages
        .filter((m) => !m.id.startsWith("temp-"))
        .concat({
          ...newMessage,
          author: {
            display_name: profileRef.current?.display_name || null,
            avatar_url: profileRef.current?.avatar_url || null,
          },
          reactions: [],
          reply_to: currentReplyTo ? { text: currentReplyTo.text, author: currentReplyTo.author } : null,
        });
      
      const messagesToCache: CachedMessage[] = realMessages.map(m => ({
        id: m.id,
        text: m.text,
        author_id: m.author_id,
        created_at: m.created_at,
        image_url: m.image_url,
        reply_to_id: m.reply_to_id,
        profiles: m.author ? { display_name: m.author.display_name, avatar_url: m.author.avatar_url } : null,
        reactions: m.reactions || [],
        reply_to: m.reply_to ? { text: m.reply_to.text, author: m.reply_to.author } : null,
      }));
      cacheMessages("dm", conversationId!, messagesToCache);
      
      // Unhide conversation if it was hidden (so it reappears for both users)
      await supabase
        .from("hidden_dm_conversations")
        .delete()
        .eq("conversation_id", conversationId!);
      
      // Invalidate other related queries
      queryClient.invalidateQueries({ queryKey: ["dm-conversations"] });
      queryClient.invalidateQueries({ queryKey: ["hidden-dm-conversations"] });
      
      // Fire-and-forget: directly invoke push notification for instant delivery
      // This bypasses pg_net trigger delays; tag-based deduplication prevents duplicates
      if (otherUserId) {
        const senderName = profileRef.current?.display_name || 'Someone';
        supabase.functions.invoke('send-push-notification', {
          body: {
            userId: otherUserId,
            title: 'Ignite Club HQ',
            body: `${senderName} sent you a message`,
            url: `/messages/dm/${conversationId}`,
            notificationId: newMessage.id,
            tag: `direct_message-${newMessage.id}`,
            notificationType: 'direct_message',
          },
        }).catch((err) => {
          console.warn('[DM] Direct push invocation failed (trigger fallback exists):', err);
        });
      }
    },
    onError: (error) => {
      toast.error("Failed to send message: " + error.message);
    },
  });
  const handleSend = () => {
    if (!message.trim()) return;
    // Allow sending if canDM is true OR if we're still checking (give benefit of doubt for existing conversations)
    // The server-side RLS will still enforce the actual permission
    if (canDM === false && !checkingCanDM) {
      toast.error("DMs require both users to be members of a Pro club");
      return;
    }
    sendMessageMutation.mutate({
      text: message.trim(),
      imageUrl: null,
      replyToId: replyTo?.id || null,
    });
    setMessage("");
    setReplyTo(null);
  };

  // Real-time subscription for new messages
  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`dm-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "direct_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["dm-messages", conversationId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, queryClient]);

  if (conversationLoading || checkingCanDM) {
    return <PageLoading />;
  }

  if (!conversation) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <p className="text-muted-foreground">Conversation not found</p>
        <Button onClick={() => navigate("/messages")}>Go to Messages</Button>
      </div>
    );
  }

  // Access denied for non-Pro users
  if (canDM === false) {
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/messages")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={otherUser?.avatar_url || undefined} />
              <AvatarFallback>{otherUser?.display_name?.charAt(0).toUpperCase() || "?"}</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="font-semibold">{otherUser?.display_name || "Unknown User"}</h1>
            </div>
          </div>
        </div>

        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-4">
            <div className="p-4 rounded-full bg-primary/10">
              <Lock className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-lg flex items-center justify-center gap-2">
                <Crown className="h-5 w-5 text-primary" />
                Pro Feature
              </h3>
              <p className="text-muted-foreground mt-1 max-w-md">
                Direct messages require both users to be members of a Pro club. 
                Upgrade your club to Pro to unlock this feature.
              </p>
            </div>
            <Button onClick={() => navigate("/messages")}>Back to Messages</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] pb-[calc(5rem+env(safe-area-inset-bottom,0px))] overflow-hidden overscroll-none" ref={pullRefreshRef as any}>
      {/* Header - Fixed at top */}
      <div className="fixed left-0 right-0 flex items-center justify-between gap-3 px-4 py-3 border-b bg-background z-40" style={{ top: 'calc(3.5rem + env(safe-area-inset-top, 0px))' }}>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/messages")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          {isIgniteSupportConversation ? (
            <>
              <div className="h-10 w-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'hsl(142, 71%, 45%)' }}>
                <Flame className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="font-semibold">Ignite Support</h1>
                <p className="text-xs text-muted-foreground">Welcome & tips</p>
              </div>
            </>
          ) : (
            <>
              <Avatar className="h-10 w-10">
                <AvatarImage src={otherUser?.avatar_url || undefined} />
                <AvatarFallback>{otherUser?.display_name?.charAt(0).toUpperCase() || "?"}</AvatarFallback>
              </Avatar>
              <div>
                <h1 className="font-semibold">{otherUser?.display_name || "Unknown User"}</h1>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <ChatSearch onSearch={setSearchQuery} />
          {!isIgniteSupportConversation && <ChatMuteButton chatType="dm" chatId={conversationId!} />}
        </div>
      </div>

      {/* Spacer for fixed header */}
      <div className="h-16 shrink-0" />

      <PullToRefreshIndicator isRefreshing={isRefreshing} pullDistance={pullDistance} pullProgress={pullProgress} />

      {/* Messages area */}
      <div
        ref={scrollAreaRef}
        className="flex-1 pr-4 -mr-4 relative overflow-y-auto overscroll-contain scrollbar-hide"
        style={{ WebkitOverflowScrolling: isNativeIOS ? 'auto' : 'touch' }}
      >
        <div className="py-4 space-y-4 pb-20">
          {showLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : localMessages?.length === 0 ? (
            <ChatEmptyState title={`Start a conversation with ${otherUser?.display_name || "this user"}`} />
          ) : (
            localMessages
              ?.filter((msg) => !searchQuery || msg.text.toLowerCase().includes(searchQuery.toLowerCase()))
              .map((msg, index, filteredMessages) => {
              const showDateSeparator = index === 0 || 
                !isSameDay(new Date(msg.created_at), new Date(filteredMessages[index - 1]?.created_at));

              return (
                <div key={msg.id}>
                  {showDateSeparator && <ChatDateSeparator date={new Date(msg.created_at)} />}
                  <div
                    id={`message-${msg.id}`}
                    className={`transition-colors duration-500 ${
                      highlightedMessageId === msg.id
                        ? "bg-primary/20 ring-2 ring-primary ring-offset-2 ring-offset-background rounded-lg p-2"
                        : ""
                    }`}
                  >
                    <ChatMessage
                      id={msg.id}
                      text={searchQuery ? highlightText(msg.text, searchQuery) as string : msg.text}
                      imageUrl={msg.image_url}
                      authorId={msg.author_id}
                      authorName={isIgniteSupportUser(msg.author_id) ? "Ignite Support" : (getProfile(msg.author_id)?.display_name || msg.author?.display_name || null)}
                      authorAvatar={getProfile(msg.author_id)?.avatar_url || msg.author?.avatar_url || null}
                      timestamp={format(new Date(msg.created_at), "h:mm a")}
                      isOwn={msg.author_id === user?.id}
                      isAdmin={false}
                      reactions={msg.reactions || []}
                      currentUserId={user?.id}
                      messageType="dm"
                      readFrontierReaders={readFrontier[msg.id] || []}
                      readCount={readCounts[msg.id] || 0}
                      readerName={msg.author_id === user?.id ? (otherUser?.display_name || null) : null}
                      isLastMessage={index === filteredMessages.length - 1}
                      queryKey={["dm-messages", conversationId]}
                      replyToMessage={
                        msg.reply_to
                          ? { text: msg.reply_to.text, authorName: msg.reply_to.author?.display_name || null }
                          : null
                      }
                      onReply={isIgniteSupportConversation ? undefined : () => setReplyTo(msg)}
                    />
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Reply preview */}
      {replyTo && (
        <ReplyPreview
          replyingTo={{ id: replyTo.id, text: replyTo.text, authorName: replyTo.author?.display_name || null }}
          onCancel={() => setReplyTo(null)}
        />
      )}

      {/* Input area - Fixed at bottom above nav bar */}
      {isIgniteSupportConversation ? (
        <>
          <div className="fixed left-0 right-0 bg-background z-[49]" style={{ bottom: 0, height: 'calc(4rem + env(safe-area-inset-bottom, 0px) + 3rem)' }} />
          <div className="fixed left-0 right-0 border-t pt-1 pb-2 px-4 bg-background z-[51]" style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom, 0px))' }}>
            <div className="text-center text-sm text-muted-foreground py-3 bg-muted/50 rounded-lg">
              This is a welcome message from Ignite Support. Replies are not available.
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="fixed left-0 right-0 bg-background z-[49]" style={{ bottom: 0, height: 'calc(4rem + env(safe-area-inset-bottom, 0px) + 3rem)' }} />
          <div className="fixed left-0 right-0 border-t pt-1 pb-2 px-4 bg-background z-[51]" style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom, 0px))' }}>
            <div className="flex gap-2 items-end">
              <MentionInput
                value={message}
                onChange={setMessage}
                onKeyPress={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                placeholder="Type a message... (@ to mention)"
                disabled={sendMessageMutation.isPending}
              />
              
              <Button 
                onClick={handleSend} 
                disabled={!message.trim() || sendMessageMutation.isPending}
                size="icon"
              >
                {sendMessageMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
