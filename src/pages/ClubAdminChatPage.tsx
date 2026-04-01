import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useChatViewportHeight } from "@/hooks/useChatViewportHeight";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Send, Loader2, Users, Search } from "lucide-react";
import { PageLoading } from "@/components/ui/page-loading";
import { ChatHeaderMenu } from "@/components/chat/ChatHeaderMenu";
import { toast } from "sonner";
import { ReplyPreview } from "@/components/chat/ReplyPreview";
import { EditingBanner } from "@/components/chat/EditingBanner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { MentionInput } from "@/components/chat/MentionInput";
import { format, isSameDay } from "date-fns";
import { ChatDateSeparator } from "@/components/chat/ChatDateSeparator";
import { fetchProfilesWithCache } from "@/lib/profileCache";
import { useProfiles } from "@/hooks/useProfiles";
import { ChatSearchBar } from "@/components/chat/ChatSearch";
import { Capacitor } from "@capacitor/core";

const MESSAGES_PER_PAGE = 15;

interface ClubAdminMessage {
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

export default function ClubAdminChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [replyTo, setReplyTo] = useState<ClubAdminMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<{ id: string; text: string } | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const profileRef = useRef(profile);
  profileRef.current = profile;
  const replyToRef = useRef(replyTo);
  replyToRef.current = replyTo;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  const chatHeight = useChatViewportHeight();
  const isNativePlatform = Capacitor.isNativePlatform();

  const scrollToBottom = useCallback(() => {
    if (!scrollAreaRef.current) return;
    scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
  }, []);

  // Scroll to bottom when keyboard opens
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let prevHeight = vv.height;
    const handleResize = () => {
      const currentHeight = vv.height;
      if (prevHeight - currentHeight > 100) {
        requestAnimationFrame(() => scrollToBottom());
      }
      prevHeight = currentHeight;
    };
    vv.addEventListener("resize", handleResize);
    return () => vv.removeEventListener("resize", handleResize);
  }, [scrollToBottom]);

  // Fetch conversation details
  const { data: conversation, isLoading: conversationLoading } = useQuery({
    queryKey: ["club-admin-conversation", conversationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("club_admin_conversations")
        .select("*")
        .eq("id", conversationId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!conversationId,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch club details
  const { data: club } = useQuery({
    queryKey: ["club-detail-chat", conversation?.club_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("id, name, logo_url")
        .eq("id", conversation!.club_id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!conversation?.club_id,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch member profile (for admin view)
  const { data: memberProfile } = useQuery({
    queryKey: ["club-admin-member-profile", conversation?.member_user_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .eq("id", conversation!.member_user_id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!conversation?.member_user_id,
    staleTime: 5 * 60 * 1000,
  });

  // Determine if current user is the member or an admin
  const isMember = conversation?.member_user_id === user?.id;

  // Chat title
  const chatTitle = isMember
    ? `${club?.name || "Club"} Admin`
    : memberProfile?.display_name || "Member";

  const chatSubtitle = isMember
    ? "Chat with club admins"
    : `${club?.name || "Club"} admin chat`;

  // Memoize query key
  const queryKey = useMemo(() => ["club-admin-messages", conversationId], [conversationId]);

  // Fetch messages
  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data: rawMessages, error } = await supabase
        .from("club_admin_messages")
        .select("id, text, image_url, created_at, author_id, conversation_id, reply_to_id, deleted_at")
        .eq("conversation_id", conversationId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(MESSAGES_PER_PAGE + 1);
      if (error) throw error;

      if (!rawMessages?.length) {
        return { messages: [] as ClubAdminMessage[], hasOlderMessages: false };
      }

      const hasMore = rawMessages.length > MESSAGES_PER_PAGE;
      const dataToDisplay = hasMore ? rawMessages.slice(0, MESSAGES_PER_PAGE) : rawMessages;

      const messageIds = dataToDisplay.map((m) => m.id);
      const replyToIds = dataToDisplay.filter((m) => m.reply_to_id).map((m) => m.reply_to_id as string);
      const authorIds = [...new Set(dataToDisplay.map((m) => m.author_id))];

      const [reactionsResult, replyToResult, profilesMap] = await Promise.all([
        supabase
          .from("message_reactions")
          .select("id, user_id, reaction_type, club_admin_message_id")
          .in("club_admin_message_id", messageIds),
        replyToIds.length > 0
          ? supabase
              .from("club_admin_messages")
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
        const replyToData = msg.reply_to_id ? replyToMap.get(msg.reply_to_id) || null : null;
        const msgProfile = profilesMap.get(msg.author_id);
        const msgReactions = (reactionsResult.data || [])
          .filter((r: any) => r.club_admin_message_id === msg.id)
          .map((r: any) => ({ id: r.id, user_id: r.user_id, reaction_type: r.reaction_type }));
        return {
          ...msg,
          author: msgProfile ? { display_name: msgProfile.display_name, avatar_url: msgProfile.avatar_url } : null,
          reply_to: replyToData,
          reactions: msgReactions,
        };
      }) as ClubAdminMessage[];

      return { messages, hasOlderMessages: hasMore };
    },
    enabled: !!conversationId,
    staleTime: 30 * 1000,
    refetchOnMount: 'always' as const,
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

  const [localMessages, setLocalMessages] = useState<ClubAdminMessage[] | undefined>(undefined);
  const localMessagesRef = useRef(localMessages);
  localMessagesRef.current = localMessages;
  const hasInitialScrolled = useRef(false);

  const authorIds = useMemo(() => {
    return [...new Set((localMessages || []).map(m => m.author_id).filter(Boolean))];
  }, [localMessages]);
  const { getProfile } = useProfiles(authorIds);

  // Sync localMessages with fetched messages
  useEffect(() => {
    if (messages) {
      if (messages.length > 0) {
        setLocalMessages(messages);
      } else if (!messagesLoading) {
        setLocalMessages(messages);
      }
    }
  }, [messages, messagesLoading]);

  // Initial scroll to bottom
  useEffect(() => {
    if (!localMessages?.length) return;
    if (hasInitialScrolled.current) return;

    const tryScroll = () => {
      if (!scrollAreaRef.current) return;
      hasInitialScrolled.current = true;
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
      setTimeout(() => { if (scrollAreaRef.current) scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight; }, 50);
    };
    tryScroll();
  }, [localMessages]);

  // Reset on conversation change
  useEffect(() => {
    hasInitialScrolled.current = false;
  }, [conversationId]);

  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["club-admin-messages", conversationId] });
  }, [queryClient, conversationId]);

  const handleManualRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    try { await handleRefresh(); } finally { setIsManualRefreshing(false); }
  }, [handleRefresh]);

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ text, replyToId }: { text: string; replyToId?: string | null }) => {
      const { data, error } = await supabase
        .from("club_admin_messages")
        .insert({
          conversation_id: conversationId!,
          author_id: user!.id,
          text,
          reply_to_id: replyToId || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onMutate: async ({ text, replyToId }) => {
      const optimisticMessage: ClubAdminMessage = {
        id: `temp-${Date.now()}`,
        text,
        image_url: null,
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
    onSuccess: (newMessage) => {
      const currentReplyTo = replyToRef.current;
      queryClient.setQueryData(
        queryKey,
        (oldData: { messages: ClubAdminMessage[]; hasOlderMessages: boolean } | undefined) => {
          if (!oldData) {
            return {
              messages: [{
                ...newMessage,
                author: { display_name: profileRef.current?.display_name || null, avatar_url: profileRef.current?.avatar_url || null },
                reactions: [],
                reply_to: currentReplyTo ? { text: currentReplyTo.text, author: currentReplyTo.author } : null,
              }],
              hasOlderMessages: false,
            };
          }
          const updatedMessages = oldData.messages
            .filter((m) => !m.id.startsWith("temp-"))
            .concat({
              ...newMessage,
              author: { display_name: profileRef.current?.display_name || null, avatar_url: profileRef.current?.avatar_url || null },
              reactions: [],
              reply_to: currentReplyTo ? { text: currentReplyTo.text, author: currentReplyTo.author } : null,
            });
          return { ...oldData, messages: updatedMessages };
        }
      );
    },
    onError: () => {
      toast.error("Failed to send message. Please try again.");
      setLocalMessages((prev) => prev?.filter(m => !m.id.startsWith("temp-")) || null);
    },
  });

  const updateMessageMutation = useMutation({
    mutationFn: async () => {
      if (!editingMessage) return;
      const { error } = await supabase.from("club_admin_messages").update({ text: message.trim() }).eq("id", editingMessage.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setMessage("");
      setEditingMessage(null);
      queryClient.invalidateQueries({ queryKey });
      // silent success
    },
    onError: () => toast.error("Failed to update message"),
  });

  const handleEdit = useCallback((msg: { id: string; text: string }) => {
    setEditingMessage(msg);
    setMessage(msg.text);
    setReplyTo(null);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null);
    setMessage("");
  }, []);

  const handleSend = () => {
    if (!message.trim()) return;
    if (editingMessage) {
      updateMessageMutation.mutate();
      return;
    }
    sendMessageMutation.mutate({
      text: message.trim(),
      replyToId: replyTo?.id || null,
    });
    setMessage("");
    setReplyTo(null);
  };

  // Real-time subscription
  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`club-admin-chat-${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "club_admin_messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const newMsg = payload.new as any;
          queryClient.setQueryData(
            queryKey,
            (old: { messages: ClubAdminMessage[]; hasOlderMessages: boolean } | undefined) => {
              if (!old) return old;
              if (old.messages.some(m => m.id === newMsg.id)) return old;
              const filtered = old.messages.filter(m => !(m.id.startsWith('temp-') && m.author_id === newMsg.author_id));
              return {
                ...old,
                messages: [...filtered, { ...newMsg, author: null, reactions: [], reply_to: null }].sort(
                  (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                ),
              };
            }
          );
          // Fetch profile async
          supabase.from("profiles").select("display_name, avatar_url").eq("id", newMsg.author_id).maybeSingle().then(({ data: p }) => {
            if (!p) return;
            queryClient.setQueryData(queryKey, (old: any) => {
              if (!old) return old;
              return {
                ...old,
                messages: old.messages.map((m: any) =>
                  m.id === newMsg.id ? { ...m, author: { display_name: p.display_name, avatar_url: p.avatar_url } } : m
                ),
              };
            });
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "club_admin_messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const updated = payload.new as any;
          queryClient.setQueryData(queryKey, (old: any) => {
            if (!old) return old;
            if (updated.deleted_at) {
              return { ...old, messages: old.messages.filter((m: any) => m.id !== updated.id) };
            }
            return {
              ...old,
              messages: old.messages.map((m: any) =>
                m.id === updated.id ? { ...m, text: updated.text, image_url: updated.image_url } : m
              ),
            };
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reactions" },
        (payload) => {
          const reaction = payload.new as any;
          if (!reaction.club_admin_message_id) return;
          queryClient.setQueryData(queryKey, (old: any) => {
            if (!old) return old;
            return {
              ...old,
              messages: old.messages.map((m: any) => {
                if (m.id !== reaction.club_admin_message_id) return m;
                const reactions = m.reactions || [];
                if (reactions.some((r: any) => r.id === reaction.id)) return m;
                const filtered = reactions.filter((r: any) => !(r.id.startsWith('temp-') && r.user_id === reaction.user_id));
                return { ...m, reactions: [...filtered, { id: reaction.id, user_id: reaction.user_id, reaction_type: reaction.reaction_type }] };
              }),
            };
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "message_reactions" },
        (payload) => {
          const deleted = payload.old as any;
          if (!deleted.id) return;
          queryClient.setQueryData(queryKey, (old: any) => {
            if (!old) return old;
            return {
              ...old,
              messages: old.messages.map((m: any) => ({
                ...m,
                reactions: (m.reactions || []).filter((r: any) => r.id !== deleted.id),
              })),
            };
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversationId, queryClient, queryKey]);

  // Visibility change handler
  useEffect(() => {
    let lastRefresh = Date.now();
    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible" && conversationId) {
        if (Date.now() - lastRefresh > 30000) {
          lastRefresh = Date.now();
          await queryClient.invalidateQueries({ queryKey });
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [conversationId, queryClient, queryKey]);

  if (conversationLoading) return <PageLoading />;

  if (!conversation) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <p className="text-muted-foreground">Conversation not found</p>
        <Button onClick={() => navigate("/messages")}>Go to Messages</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-hidden overscroll-none" style={{ height: chatHeight, paddingBottom: "calc(var(--bottom-nav-offset, 5rem) + 1rem)" }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b bg-background shrink-0 relative">
        <ChatSearchBar onSearch={setSearchQuery} isOpen={searchOpen} onOpenChange={setSearchOpen} />
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/messages")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <Avatar className="h-10 w-10">
            <AvatarImage src={isMember ? (club?.logo_url || undefined) : (memberProfile?.avatar_url || undefined)} />
            <AvatarFallback className="bg-primary/10 text-primary">
              {(isMember ? club?.name : memberProfile?.display_name)?.charAt(0).toUpperCase() || "?"}
            </AvatarFallback>
          </Avatar>
          <div>
            <h1 className="font-semibold flex items-center gap-2">
              {chatTitle}
              <Users className="h-4 w-4 text-muted-foreground" />
            </h1>
            <p className="text-xs text-muted-foreground">{chatSubtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSearchOpen(true)}>
            <Search className="h-4 w-4" />
          </Button>
          <ChatHeaderMenu
            onRefresh={handleManualRefresh}
            isRefreshing={isManualRefreshing}
          />
        </div>
      </div>

      {/* Messages area */}
      <div
        ref={scrollAreaRef}
        data-chat-scroll-lock="true"
        className="flex-1 pr-4 -mr-4 relative overflow-y-auto overscroll-none scrollbar-hide"
        style={{ WebkitOverflowScrolling: isNativeIOS ? 'auto' : 'touch' }}
      >
        <div className="p-4 space-y-4 pb-28">
          {showLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : localMessages?.length === 0 ? (
            <ChatEmptyState title={isMember ? `Send a message to ${club?.name || "club"} admins` : `Start a conversation with ${memberProfile?.display_name || "this member"}`} />
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
                        text={msg.text}
                        imageUrl={msg.image_url}
                        authorId={msg.author_id}
                        authorName={getProfile(msg.author_id)?.display_name || msg.author?.display_name || null}
                        authorAvatar={getProfile(msg.author_id)?.avatar_url || msg.author?.avatar_url || null}
                        timestamp={format(new Date(msg.created_at), "h:mm a")}
                        isOwn={msg.author_id === user?.id}
                        isAdmin={false}
                        reactions={msg.reactions || []}
                        currentUserId={user?.id}
                        messageType="club_admin"
                        searchQuery={searchQuery}
                        queryKey={queryKey}
                        contextId={conversationId || ""}
                        replyToMessage={
                          msg.reply_to
                            ? { text: msg.reply_to.text, authorName: msg.reply_to.author?.display_name || null }
                            : null
                        }
                        onReply={() => setReplyTo(msg)}
                        onEdit={handleEdit}
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
      {editingMessage && <EditingBanner text={editingMessage.text} onCancel={handleCancelEdit} />}

      {/* Input area */}
      <div className="fixed left-0 right-0 bg-background z-[49] pointer-events-none" style={{ bottom: 0, height: "calc(var(--bottom-nav-offset, 5rem) + 3rem)" }} />
      <div className="fixed left-0 right-0 border-t pt-1 pb-2 px-2 bg-background z-[51]" style={{ bottom: "var(--bottom-nav-offset, 5rem)" }}>
        <div className="flex gap-1.5 items-center">
          <MentionInput
            value={message}
            onChange={setMessage}
            onKeyPress={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="Type a message..."
            disabled={sendMessageMutation.isPending}
          />
          <button
            onClick={handleSend}
            disabled={!message.trim() || sendMessageMutation.isPending}
            className="flex items-center justify-center h-[44px] w-[44px] shrink-0 rounded-full bg-primary text-primary-foreground disabled:opacity-40 transition-opacity"
          >
            {sendMessageMutation.isPending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
