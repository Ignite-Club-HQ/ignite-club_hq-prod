import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Send, MoreVertical, Reply, SmilePlus, Loader2, RefreshCw, Crown, Lock } from "lucide-react";
import { PageLoading } from "@/components/ui/page-loading";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { PullToRefreshIndicator } from "@/components/chat/PullToRefreshIndicator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { ChatImageInput } from "@/components/chat/ChatImageInput";
import { ReplyPreview } from "@/components/chat/ReplyPreview";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { MessageContent } from "@/components/chat/MessageContent";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, isSameDay } from "date-fns";
import { ChatDateSeparator } from "@/components/chat/ChatDateSeparator";
import { useMessageReads } from "@/hooks/useMessageReads";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { MessageReadIndicator } from "@/components/chat/MessageReadIndicator";
import { fetchProfilesWithCache } from "@/lib/profileCache";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const MESSAGES_PER_PAGE = 15;
const REACTION_EMOJIS = ["❤️", "🔥", "👏", "😂", "😮", "😢"];

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
}

interface DirectConversation {
  id: string;
  participant_1: string;
  participant_2: string;
  created_at: string;
  updated_at: string;
}

interface MessageReaction {
  id: string;
  user_id: string;
  reaction_type: string;
  direct_message_id: string | null;
}

export default function DirectMessagePage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, profile, refreshUnreadCount } = useAuth();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<DirectMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<DirectMessage | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  const profileRef = useRef(profile);
  profileRef.current = profile;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  
  const scrollToBottom = useCallback(() => {
    if (!scrollAreaRef.current) return;
    const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
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

  // Check if DM is allowed (both users in Pro club)
  const { data: canDM, isLoading: checkingCanDM } = useQuery({
    queryKey: ["can-dm", otherUserId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("can_dm_user", { other_user_id: otherUserId });
      if (error) throw error;
      return data as boolean;
    },
    enabled: !!otherUserId,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch messages
  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ["dm-messages", conversationId],
    queryFn: async () => {
      const { data: rawMessages, error } = await supabase
        .from("direct_messages")
        .select("id, text, image_url, created_at, author_id, conversation_id, reply_to_id")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(MESSAGES_PER_PAGE + 1);
      if (error) throw error;
      
      if (!rawMessages?.length) {
        return { messages: [] as DirectMessage[], hasOlderMessages: false, reactions: [] as MessageReaction[] };
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
        return {
          ...msg,
          author: profile ? { display_name: profile.display_name, avatar_url: profile.avatar_url } : null,
          reply_to: replyTo,
        };
      }) as DirectMessage[];
      
      return {
        messages,
        hasOlderMessages: hasMore,
        reactions: (reactionsResult.data || []) as MessageReaction[],
      };
    },
    enabled: !!conversationId,
    staleTime: 1000 * 60 * 5,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
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
  const hasInitialScrolled = useRef(false);
  const [infiniteScrollEnabled, setInfiniteScrollEnabled] = useState(false);
  
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

  useEffect(() => {
    if (messages && messages.length > 0) {
      setLocalMessages(messages);
    }
  }, [messages]);

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
      const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
      if (!viewport) {
        if (attempts < maxAttempts) setTimeout(tryScroll, 100);
        return;
      }
      hasInitialScrolled.current = true;
      setInfiniteScrollEnabled(true);
      viewport.scrollTop = viewport.scrollHeight;
      setTimeout(() => { viewport.scrollTop = viewport.scrollHeight; }, 50);
      setTimeout(() => { viewport.scrollTop = viewport.scrollHeight; }, 150);
    };
    tryScroll();
  }, [localMessages]);

  const reactions = useMemo(() => {
    if (!messagesData || Array.isArray(messagesData)) return [];
    return (messagesData as any).reactions || [];
  }, [messagesData]);

  useEffect(() => {
    if (messagesData && !Array.isArray(messagesData)) {
      setHasOlderMessages((messagesData as any).hasOlderMessages ?? false);
    }
  }, [messagesData]);

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ text, imageUrl, replyToId }: { text: string; imageUrl?: string | null; replyToId?: string | null }) => {
      const { data, error } = await supabase
        .from("direct_messages")
        .insert({
          conversation_id: conversationId!,
          author_id: user!.id,
          text,
          image_url: imageUrl,
          reply_to_id: replyToId,
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dm-messages", conversationId] });
      queryClient.invalidateQueries({ queryKey: ["dm-conversations"] });
    },
    onError: (error) => {
      toast.error("Failed to send message: " + error.message);
    },
  });

  // React to message mutation
  const reactMutation = useMutation({
    mutationFn: async ({ messageId, reactionType }: { messageId: string; reactionType: string }) => {
      const { data: existing } = await supabase
        .from("message_reactions")
        .select("id")
        .eq("direct_message_id", messageId)
        .eq("user_id", user!.id)
        .eq("reaction_type", reactionType)
        .maybeSingle();

      if (existing) {
        await supabase.from("message_reactions").delete().eq("id", existing.id);
      } else {
        await supabase.from("message_reactions").insert({
          direct_message_id: messageId,
          user_id: user!.id,
          reaction_type: reactionType,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dm-messages", conversationId] });
    },
  });

  const handleSend = () => {
    if (!message.trim() && !imageUrl) return;
    if (!canDM) {
      toast.error("DMs require both users to be members of a Pro club");
      return;
    }
    sendMessageMutation.mutate({
      text: message.trim(),
      imageUrl,
      replyToId: replyTo?.id,
    });
    setMessage("");
    setImageUrl(null);
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
              <p className="text-xs text-muted-foreground">Direct Message</p>
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
    <div className="flex flex-col h-[calc(100vh-8rem)]" ref={pullRefreshRef as any}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 pb-4 border-b shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/messages")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <Avatar className="h-10 w-10">
            <AvatarImage src={otherUser?.avatar_url || undefined} />
            <AvatarFallback>{otherUser?.display_name?.charAt(0).toUpperCase() || "?"}</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="font-semibold">{otherUser?.display_name || "Unknown User"}</h1>
            <p className="text-xs text-muted-foreground">Direct Message</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={handleManualRefresh} disabled={isAnyRefreshing}>
            <RefreshCw className={`h-4 w-4 ${isAnyRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <PullToRefreshIndicator isRefreshing={isRefreshing} pullDistance={pullDistance} pullProgress={pullProgress} />

      {/* Messages area */}
      <ScrollArea ref={scrollAreaRef} className="flex-1 pr-4 -mr-4 relative">
        <div className="py-4 space-y-4 pb-2">
          {showLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : localMessages?.length === 0 ? (
            <ChatEmptyState title={`Start a conversation with ${otherUser?.display_name || "this user"}`} />
          ) : (
            localMessages?.map((msg, index) => {
              const isOwn = msg.author_id === user?.id;
              const showDateSeparator = index === 0 || 
                !isSameDay(new Date(msg.created_at), new Date(localMessages[index - 1]?.created_at));
              
              const messageReactions = reactions.filter((r: MessageReaction) => r.direct_message_id === msg.id);
              const reactionCounts = messageReactions.reduce((acc: Record<string, { count: number; hasOwn: boolean }>, r: MessageReaction) => {
                if (!acc[r.reaction_type]) {
                  acc[r.reaction_type] = { count: 0, hasOwn: false };
                }
                acc[r.reaction_type].count++;
                if (r.user_id === user?.id) acc[r.reaction_type].hasOwn = true;
                return acc;
              }, {} as Record<string, { count: number; hasOwn: boolean }>);

              return (
                <div key={msg.id}>
                  {showDateSeparator && <ChatDateSeparator date={new Date(msg.created_at)} />}
                  
                  <div className={`flex gap-3 group ${isOwn ? "flex-row-reverse" : ""} ${highlightedMessageId === msg.id ? "animate-pulse bg-primary/10 rounded-lg p-2 -mx-2" : ""}`}>
                    {!isOwn && (
                      <Avatar className="h-8 w-8 shrink-0 mt-1">
                        <AvatarImage src={msg.author?.avatar_url || undefined} />
                        <AvatarFallback className="text-xs">
                          {msg.author?.display_name?.charAt(0).toUpperCase() || "?"}
                        </AvatarFallback>
                      </Avatar>
                    )}
                    
                    <div className={`flex flex-col ${isOwn ? "items-end" : "items-start"} max-w-[75%]`}>
                      {msg.reply_to && (
                        <div className="text-xs text-muted-foreground mb-1 bg-muted/50 rounded px-2 py-1">
                          ↩ Replying to: {msg.reply_to.text.substring(0, 50)}...
                        </div>
                      )}
                      
                      <div className={`rounded-2xl px-4 py-2 ${
                        isOwn 
                          ? "bg-primary text-primary-foreground rounded-tr-sm" 
                          : "bg-muted rounded-tl-sm"
                      }`}>
                        <MessageContent text={msg.text} imageUrl={msg.image_url} />
                      </div>
                      
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(msg.created_at), "h:mm a")}
                        </span>
                        
                        {/* Reaction counts */}
                        {Object.entries(reactionCounts).map(([emoji, data]) => (
                          <button
                            key={emoji}
                            onClick={() => reactMutation.mutate({ messageId: msg.id, reactionType: emoji })}
                            className={`text-xs px-1.5 py-0.5 rounded-full flex items-center gap-1 ${
                              data.hasOwn ? "bg-primary/20" : "bg-muted"
                            }`}
                          >
                            {emoji} {data.count}
                          </button>
                        ))}
                        
                        {/* Actions - shown on hover */}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => setReplyTo(msg)}
                          >
                            <Reply className="h-3 w-3" />
                          </Button>
                          
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6">
                                <SmilePlus className="h-3 w-3" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-2">
                              <div className="flex gap-1">
                                {REACTION_EMOJIS.map((emoji) => (
                                  <button
                                    key={emoji}
                                    onClick={() => reactMutation.mutate({ messageId: msg.id, reactionType: emoji })}
                                    className="text-lg hover:bg-muted p-1 rounded"
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                            </PopoverContent>
                          </Popover>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Reply preview */}
      {replyTo && (
        <ReplyPreview
          replyingTo={{ id: replyTo.id, text: replyTo.text, authorName: replyTo.author?.display_name || null }}
          onCancel={() => setReplyTo(null)}
        />
      )}

      {/* Input area */}
      <div className="pt-4 border-t shrink-0">
        <div className="flex gap-2 items-end">
          <ChatImageInput onImageUploaded={setImageUrl} imageUrl={imageUrl} />
          
          <div className="flex-1">
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              placeholder="Type a message..."
              disabled={sendMessageMutation.isPending}
            />
          </div>
          
          <Button 
            onClick={handleSend} 
            disabled={(!message.trim() && !imageUrl) || sendMessageMutation.isPending}
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
    </div>
  );
}
