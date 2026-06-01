import React, { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from "react";
import { consumePendingChatJump } from "@/lib/pendingChatJump";
import { fuzzyMatchesQuery } from "@/lib/fuzzySearch";
import { useChatDraft } from "@/hooks/useChatDraft";
import { useSyncActiveClubToChat } from "@/hooks/useSyncActiveClubToChat";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useChatViewportHeight } from "@/hooks/useChatViewportHeight";
import { useMeasuredElementHeight } from "@/hooks/useMeasuredElementHeight";
import { ChatMessagesScroller } from "@/components/chat/ChatMessagesScroller";
import type { VirtualizedChatMessageListHandle } from "@/components/chat/VirtualizedChatMessageList";
import { jumpToMessageInVirtualizedChat } from "@/lib/jumpToMessage";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";
import { useNativeKeyboardHeight } from "@/hooks/useNativeKeyboardHeight";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Send, Loader2, Users, Search, BarChart3 } from "lucide-react";
import { CreatePollDialog } from "@/components/chat/CreatePollDialog";
import { PollAttachmentPreview } from "@/components/chat/PollAttachmentPreview";
import { ChatBackButton } from "@/components/chat/ChatBackButton";
import { useSwipeBack } from "@/hooks/useSwipeBack";
import { PageLoading } from "@/components/ui/page-loading";
import { ChatHeaderMenu } from "@/components/chat/ChatHeaderMenu";
import { toast } from "sonner";
import { ReplyPreview } from "@/components/chat/ReplyPreview";
import { EditingBanner } from "@/components/chat/EditingBanner";
import { ChatSendButton } from "@/components/chat/ChatSendButton";
import { ScheduleMessageDialog } from "@/components/chat/ScheduleMessageDialog";
import { ScheduledMessagesBanner } from "@/components/chat/ScheduledMessagesBanner";
import type { ScheduleTarget } from "@/hooks/useScheduledMessages";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { shouldGroupWithPrev } from "@/lib/chatGrouping";
import { MentionInput } from "@/components/chat/MentionInput";
import { ChatComposerShell } from "@/components/chat/ChatComposerShell";
import { format, isSameDay } from "date-fns";
import { ChatDateSeparator } from "@/components/chat/ChatDateSeparator";
import { fetchProfilesWithCache, getProfileFromCache } from "@/lib/profileCache";
import { queueMessage } from "@/lib/messageQueue";
import { getCachedMessages, cacheMessages } from "@/lib/messageCache";
import { useProfiles } from "@/hooks/useProfiles";
import { ChatSearchBar, ChatSearchLoadingState } from "@/components/chat/ChatSearch";
import { useChatHistorySearch } from "@/hooks/useChatHistorySearch";
import { searchChatHistory } from "@/lib/searchChatHistory";
import { Capacitor } from "@capacitor/core";

import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { noteChatMount, noteChatUnmount, noteChannelSubscribed, noteChannelRemoved } from "@/lib/chatPerfDiagnostics";

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

const getCachedClubAdminMessages = (conversationId: string): ClubAdminMessage[] =>
  getCachedMessages("club_admin", conversationId).map((m) => ({
    id: m.id,
    text: m.text,
    image_url: m.image_url,
    created_at: m.created_at,
    author_id: m.author_id,
    conversation_id: conversationId,
    reply_to_id: m.reply_to_id,
    author: m.profiles
      ? { display_name: m.profiles.display_name, avatar_url: m.profiles.avatar_url }
      : undefined,
    reply_to: m.reply_to
      ? {
          text: m.reply_to.text,
          author: m.reply_to.author ?? (m.reply_to.profiles ? { display_name: m.reply_to.profiles.display_name } : undefined),
        }
      : null,
    reactions: (m.reactions || []).map((r) => ({
      id: r.id || `cached-${m.id}-${r.user_id}-${r.reaction_type}`,
      user_id: r.user_id,
      reaction_type: r.reaction_type,
    })),
  }));

export default function ClubAdminChatPage() {
  // [chat-perf-diag] track mount/unmount lifetime
  React.useEffect(() => {
    const k = noteChatMount("ClubAdminChat", null);
    return () => noteChatUnmount("ClubAdminChat", k, null);
  }, []);
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, profile, initialized } = useAuth();
  const queryClient = useQueryClient();
  const authReady = !!user && initialized;
  const [message, setMessage, clearDraft] = useChatDraft(conversationId);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const scheduleTarget: ScheduleTarget | null = conversationId
    ? { chat_type: "club_admin", conversation_id: conversationId }
    : null;
  const [replyTo, setReplyTo] = useState<ClubAdminMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<{ id: string; text: string } | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [pollDialogOpen, setPollDialogOpen] = useState(false);
  const [pendingPollId, setPendingPollId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const profileRef = useRef(profile);
  profileRef.current = profile;
  const replyToRef = useRef(replyTo);
  replyToRef.current = replyTo;
  // Legacy DOM refs kept declared so non-scroll code paths still compile.
  // Virtuoso owns scroll end-to-end via virtualHandleRef.
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const virtualHandleRef = useRef<VirtualizedChatMessageListHandle>(null);
  const { elementRef: composerRef, height: composerHeight } = useMeasuredElementHeight<HTMLDivElement>(
    [replyTo?.id, editingMessage?.id],
    56,
  );
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  const swipeBack = useSwipeBack();

  const chatHeight = useChatViewportHeight();
  const isKeyboardOpen = useKeyboardOpen();
  const nativeKbHeight = useNativeKeyboardHeight();
  const isNativePlatform = Capacitor.isNativePlatform();

  const scrollToBottom = useCallback(() => {
    virtualHandleRef.current?.scrollToBottom("auto");
  }, []);

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
    enabled: !!conversationId && authReady,
    staleTime: 5 * 60 * 1000,
  });

  // Sync active club to this conversation's club so push-launched threads
  // don't leave the user inside the wrong club context.
  useSyncActiveClubToChat(conversation?.club_id);

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
    enabled: !!conversation?.club_id && authReady,
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
    enabled: !!conversation?.member_user_id && authReady,
    staleTime: 5 * 60 * 1000,
  });

  // Determine if current user is the member or an admin
  const isMember = conversation?.member_user_id === user?.id;

  // Seed the header (name + avatar) from the already-loaded admin inbox cache
  // or the shared profile cache, so the chat opens with the member's actual
  // name on first paint instead of flashing "Member" for ~1s while the
  // conversation→profile network round-trip resolves.
  const inboxFallback = useMemo(() => {
    if (!conversationId) return null;
    const inboxQueries = queryClient.getQueriesData<any[]>({ queryKey: ["club-admin-inbox"] });
    for (const [, rows] of inboxQueries) {
      const match = Array.isArray(rows) ? rows.find((r) => r?.id === conversationId) : null;
      if (match) return { name: match.member_name as string | null, avatar: match.member_avatar as string | null };
    }
    return null;
  }, [conversationId, queryClient, conversation?.member_user_id]);

  const cachedMemberProfile = useMemo(() => {
    if (!conversation?.member_user_id) return null;
    return getProfileFromCache(conversation.member_user_id);
  }, [conversation?.member_user_id]);

  const resolvedMemberName =
    memberProfile?.display_name ||
    cachedMemberProfile?.display_name ||
    (inboxFallback?.name && inboxFallback.name !== "Member" ? inboxFallback.name : null);
  const resolvedMemberAvatar =
    memberProfile?.avatar_url ||
    cachedMemberProfile?.avatar_url ||
    inboxFallback?.avatar ||
    null;

  // Chat title
  const chatTitle = isMember
    ? `${club?.name || "Club"} Admin`
    : resolvedMemberName || "Member";

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
    enabled: !!conversationId && authReady,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    placeholderData: (prev: any) => prev,
  });

  const messages = useMemo(() => {
    if (!messagesData) return [];
    const msgList = Array.isArray(messagesData)
      ? messagesData
      : (messagesData as any).messages || [];
    return [...msgList].sort((a, b) =>
      (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) || a.id.localeCompare(b.id)
    );
  }, [messagesData]);

  const [localMessages, setLocalMessages] = useState<ClubAdminMessage[] | undefined>(() =>
    conversationId ? getCachedClubAdminMessages(conversationId) : undefined,
  );
  const localMessagesRef = useRef(localMessages);
  localMessagesRef.current = localMessages;

  // Deep-link / push-notification jump: ?message=<id>
  // Polls until the target renders so it works even if the message
  // arrives after the initial query settles. ClubAdmin has no
  // older-message pagination, so no tryLoadOlder is wired.
  const urlMessageId = searchParams.get("message");
  const [fallbackJumpId] = useState(() =>
    conversationId ? consumePendingChatJump("club_admin", conversationId) : null,
  );
  const targetMessageId = urlMessageId ?? fallbackJumpId;
  const targetParentId = searchParams.get("parent");

  useEffect(() => {
    if (!targetMessageId) return;
    const cancel = jumpToMessageInVirtualizedChat(
      targetMessageId,
      () => localMessagesRef.current ?? [],
      () => virtualHandleRef.current,
      setHighlightedMessageId,
      { parentMessageId: targetParentId ?? undefined },
    );
    return cancel;
  }, [targetMessageId, targetParentId]);
  const showLoading =
    (!authReady && !(localMessages?.length)) ||
    (messagesLoading && !messagesData && !(localMessages?.length));

  const authorIds = useMemo(() => {
    return [...new Set((localMessages || []).map(m => m.author_id).filter(Boolean))];
  }, [localMessages]);
  const { getProfile } = useProfiles(authorIds);

  // Reset local cache view when conversation changes
  useEffect(() => {
    if (!conversationId) {
      setLocalMessages(undefined);
      return;
    }
    setLocalMessages(getCachedClubAdminMessages(conversationId));
  }, [conversationId]);

  // Sync localMessages with fetched messages
  useLayoutEffect(() => {
    // Guard: never replace existing messages with an empty array (transient cache state during resume)
    if (messages) {
      if (messages.length > 0) {
        setLocalMessages(messages);
      } else if (!messagesLoading && (!localMessages || localMessages.length === 0)) {
        setLocalMessages(messages);
      }
    }
  }, [messages, messagesLoading]);

  // Persist fetched messages to local cache for instant load next time
  useEffect(() => {
    if (!conversationId || !messages || messages.length === 0) return;
    cacheMessages(
      "club_admin",
      conversationId,
      messages.map((m) => ({
        id: m.id,
        text: m.text,
        author_id: m.author_id,
        created_at: m.created_at,
        image_url: m.image_url,
        reply_to_id: m.reply_to_id,
        profiles: m.author
          ? { display_name: m.author.display_name ?? null, avatar_url: m.author.avatar_url ?? null }
          : null,
        reactions: (m.reactions || []).map((r) => ({
          id: r.id,
          user_id: r.user_id,
          reaction_type: r.reaction_type,
        })),
        reply_to: m.reply_to
          ? {
              text: m.reply_to.text,
              author: m.reply_to.author ? { display_name: m.reply_to.author.display_name ?? null } : null,
            }
          : null,
      })),
    );
  }, [conversationId, messages]);

  const isPinned = true;

  // Reply/edit composer growth re-pin is handled inside ChatMessagesScroller
  // via the Virtuoso handle (see virtualHandleRef path). No-op here.

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
      // Offline path: queue the message instead of failing
      if (!navigator.onLine) {
        const queued = queueMessage({
          type: "club_admin",
          targetId: conversationId!,
          authorId: user!.id,
          text,
          imageUrl: null,
          replyToId: replyToId || null,
          createdAt: new Date().toISOString(),
        });
        return {
          id: queued.id,
          text,
          image_url: null,
          conversation_id: conversationId!,
          author_id: user!.id,
          reply_to_id: replyToId || null,
          created_at: queued.createdAt,
          __queued: true,
        } as any;
      }
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
    onSettled: (_data, _err, variables) => {
      // Auto-sync any file/document links shared in this Club Admin Chat
      // into a dedicated "Club Admin Chat" vault folder (club admins only).
      const clubIdForSync = conversation?.club_id;
      if (user && clubIdForSync && variables?.text) {
        import("@/lib/chatVaultSync").then(({ syncChatAttachmentToVault }) => {
          syncChatAttachmentToVault({
            imageUrl: null,
            text: variables.text,
            userId: user.id,
            clubId: clubIdForSync,
            isClubAdminChat: true,
          }).catch(() => {});
        });
      }
    },
  });

  const { isSearching: isSearchFetching, canShowEmpty: searchCanShowEmpty } = useChatHistorySearch<ClubAdminMessage>({
    searchQuery,
    loadedMessages: localMessages,
    setMessages: (updater) => setLocalMessages((prev) => updater(prev)),
    enabled: !!conversationId,
    cacheKey: `club_admin:${conversationId ?? ""}`,
    fetcher: async (q, signal) =>
      (await searchChatHistory({
        table: "club_admin_messages",
        scope: { conversation_id: conversationId! },
        query: q,
        signal,
        selectColumns: "id, text, image_url, created_at, author_id, conversation_id, reply_to_id",
      })) as ClubAdminMessage[],
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

  // Typing indicator
  const { typingUsers, startTyping, stopTyping } = useTypingIndicator(
    `club-admin-${conversationId || ""}`,
    user?.id,
    profile?.display_name || user?.email || "Someone"
  );

  const handleSend = () => {
    // Flush IME composition before reading composer state (see TeamChatPage).
    // Re-focus on next tick so the keyboard stays open and the thread does
    // not jump upward after sending.
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT")) {
      ae.blur();
      setTimeout(() => {
        handleSend();
        try { ae.focus({ preventScroll: true } as FocusOptions); } catch { /* noop */ }
      }, 0);
      return;
    }

    if (!message.trim() && !pendingPollId) return;
    if (editingMessage) {
      updateMessageMutation.mutate();
      return;
    }
    stopTyping();
    const baseText = message.trim();
    const finalText = pendingPollId
      ? (baseText ? `${baseText} [poll:${pendingPollId}]` : `[poll:${pendingPollId}]`)
      : baseText;
    sendMessageMutation.mutate({
      text: finalText,
      replyToId: replyTo?.id || null,
    });
    setMessage("");
    setReplyTo(null);
    setPendingPollId(null);
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
                  (a, b) => (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) || a.id.localeCompare(b.id)
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
        { event: "UPDATE", schema: "public", table: "message_reactions" },
        (payload) => {
          const reaction = payload.new as any;
          if (!reaction.club_admin_message_id) return;
          queryClient.setQueryData(queryKey, (old: any) => {
            if (!old) return old;
            return {
              ...old,
              messages: old.messages.map((m: any) => {
                if (m.id !== reaction.club_admin_message_id) return m;
                const newReaction = { id: reaction.id, user_id: reaction.user_id, reaction_type: reaction.reaction_type };
                const hasExisting = (m.reactions || []).some((r: any) => r.id === reaction.id);
                if (hasExisting) {
                  return { ...m, reactions: (m.reactions || []).map((r: any) => r.id === reaction.id ? newReaction : r) };
                }
                return { ...m, reactions: [...(m.reactions || []).filter((r: any) => r.user_id !== reaction.user_id), newReaction] };
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
    noteChannelSubscribed(`club-admin-chat-${conversationId}`);

    return () => { supabase.removeChannel(channel); noteChannelRemoved(`club-admin-chat-${conversationId}`); };
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

  // Don't hard-gate on conversationLoading if we already have cached messages —
  // the full-page loader would replace the chat tree mid-mount and force Virtuoso
  // to re-pin against a fresh layout, causing a visible jolt. Render the shell
  // immediately when we have cached content; only show PageLoading on true cold load.
  if (conversationLoading && !(localMessages && localMessages.length > 0)) return <PageLoading />;


  if (!conversation && !conversationLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <p className="text-muted-foreground">Conversation not found</p>
        <Button onClick={() => navigate("/messages")}>Go to Messages</Button>
      </div>
    );
  }


  return (
    <div className="flex min-h-0 flex-col overflow-hidden overscroll-none" style={{ height: chatHeight }} data-lock-keyboard-scroll="true" onTouchStart={swipeBack.onTouchStart} onTouchEnd={swipeBack.onTouchEnd}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-background shrink-0 relative">
        <ChatSearchBar onSearch={setSearchQuery} isOpen={searchOpen} onOpenChange={setSearchOpen} isSearching={isSearchFetching} />
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <ChatBackButton />
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarImage src={isMember ? (club?.logo_url || undefined) : (memberProfile?.avatar_url || undefined)} />
            <AvatarFallback className="bg-primary/10 text-primary">
              {(isMember ? club?.name : memberProfile?.display_name)?.charAt(0).toUpperCase() || "?"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h1 className="font-semibold flex items-center gap-2 truncate">
              {chatTitle}
              <Users className="h-4 w-4 text-muted-foreground shrink-0" />
            </h1>
            <p className="text-xs text-muted-foreground truncate">{chatSubtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSearchOpen(true)}>
            <Search className="h-4 w-4" />
          </Button>
          <ChatHeaderMenu
            onRefresh={handleManualRefresh}
            isRefreshing={isManualRefreshing}
          />
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden overscroll-none">
        {showLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (isSearchFetching || (!!searchQuery && !searchCanShowEmpty)) ? (
          <ChatSearchLoadingState />
        ) : filteredMessages?.length === 0 ? (
          <ChatEmptyState title={isMember ? `Send a message to ${club?.name || "club"} admins` : `Start a conversation with ${memberProfile?.display_name || "this member"}`} />
        ) : (
          <ChatMessagesScroller
            messages={filteredMessages || []}
            hasOlderMessages={false}
            isLoadingOlder={false}
            onLoadOlder={() => {}}
            isPinned={isPinned}
            isKeyboardOpen={isKeyboardOpen}
            searchOpen={searchOpen}
            composerHeight={composerHeight}
            currentUserId={user?.id}
            virtualHandleRef={virtualHandleRef}
            initialBottomPinned={!targetMessageId}
            renderRow={(msg, index, arr) => {
              const prevMessage = index > 0 ? arr[index - 1] : null;
              const nextMessage = index < arr.length - 1 ? arr[index + 1] : null;
              const showDateSeparator = !prevMessage ||
                !isSameDay(new Date(msg.created_at), new Date(prevMessage.created_at));
              const groupedWithPrev = !showDateSeparator && shouldGroupWithPrev(msg, prevMessage);
              const groupedWithNext = nextMessage
                ? isSameDay(new Date(msg.created_at), new Date(nextMessage.created_at)) && shouldGroupWithPrev(nextMessage, msg)
                : false;
              return (
                <>
                  {showDateSeparator && <ChatDateSeparator date={new Date(msg.created_at)} />}
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
                      hasReply={!!msg.reply_to_id}
                      onReply={() => {
                        setReplyTo(msg);
                        setTimeout(() => virtualHandleRef.current?.scrollToBottom("auto"), 100);
                      }}
                      onEdit={handleEdit}
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


      {/* Input area */}
      <div className={`fixed left-0 right-0 bg-background z-[49] pointer-events-none ${searchOpen ? "hidden" : ""}`} style={{ bottom: nativeKbHeight, height: nativeKbHeight > 0 ? "3rem" : "calc(var(--bottom-nav-offset, 0px) + 3rem)" }} />
      <div ref={composerRef} data-chat-chrome="true" className={`fixed left-0 right-0 w-full max-w-full overflow-visible border-t border-border/30 pt-1 pb-2 px-2 bg-background/95 z-[51] ${searchOpen ? "hidden" : ""}`} style={{ bottom: nativeKbHeight > 0 ? nativeKbHeight : "var(--bottom-nav-offset, 0px)" }}>
        <TypingIndicator typingUsers={typingUsers} />
        {replyTo && (
          <ReplyPreview
            replyingTo={{ id: replyTo.id, text: replyTo.text, authorName: replyTo.author?.display_name || null }}
            onCancel={() => setReplyTo(null)}
          />
        )}
        {editingMessage && <EditingBanner text={editingMessage.text} onCancel={handleCancelEdit} />}
        {pendingPollId && !editingMessage && (
          <PollAttachmentPreview
            pollId={pendingPollId}
            onRemove={() => setPendingPollId(null)}
            disabled={sendMessageMutation.isPending}
          />
        )}
        {scheduleTarget && <ScheduledMessagesBanner target={scheduleTarget} />}
        <ChatComposerShell>

          <MentionInput
            bare
            value={message}
            onChange={(val) => {
              setMessage(val);
              if (val.trim()) startTyping(); else stopTyping();
            }}
            onKeyPress={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="Type a message..."
            disabled={false}
            clubId={conversation?.club_id || undefined}
            clubAdminMemberUserId={conversation?.member_user_id || undefined}
          />
          <ChatSendButton
            onSend={handleSend}
            onSchedule={scheduleTarget ? () => setScheduleDialogOpen(true) : undefined}
            disabled={!message.trim() && !pendingPollId}
            loading={sendMessageMutation.isPending}
            canSend={!!message.trim() || !!pendingPollId}
          />
        </ChatComposerShell>
        {scheduleTarget && (
          <ScheduleMessageDialog
            open={scheduleDialogOpen}
            onOpenChange={setScheduleDialogOpen}
            target={scheduleTarget}
            initialText={message}
            onScheduled={() => {
              setMessage("");
              clearDraft?.();
            }}
          />
        )}
        {conversationId && (
          <CreatePollDialog
            open={pollDialogOpen}
            onOpenChange={setPollDialogOpen}
            chatType="club_admin"
            chatId={conversationId}
            onCreated={(pollId) => setPendingPollId(pollId)}
          />
        )}
      </div>
    </div>
  );
}
