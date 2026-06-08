import React, { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect } from "react";
import { consumePendingChatJump, subscribePendingChatJump, type PendingChatJumpPayload } from "@/lib/pendingChatJump";
import { fuzzyMatchesQuery } from "@/lib/fuzzySearch";
import { useChatDraft } from "@/hooks/useChatDraft";
import { useSyncActiveClubToChat } from "@/hooks/useSyncActiveClubToChat";
import { useChatViewportHeight } from "@/hooks/useChatViewportHeight";
import { ChatMessagesScroller } from "@/components/chat/ChatMessagesScroller";
import type { VirtualizedChatMessageListHandle } from "@/components/chat/VirtualizedChatMessageList";
import { useMeasuredElementHeight } from "@/hooks/useMeasuredElementHeight";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";
import { useNativeKeyboardHeight } from "@/hooks/useNativeKeyboardHeight";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Send, Loader2, Building2, Search, CalendarPlus } from "lucide-react";
import { ChatBackButton } from "@/components/chat/ChatBackButton";
import { useSwipeBack } from "@/hooks/useSwipeBack";
import { ChatHeaderShell } from "@/components/chat/ChatHeaderShell";
import { ChatDetailsSheet } from "@/components/chat/ChatDetailsSheet";
import { ChatHeaderMenu } from "@/components/chat/ChatHeaderMenu";
import { useChatOnlineCount } from "@/hooks/useChatOnlineCount";
import { useChatPageReady } from "@/hooks/useChatPageReady";
import { ChatSearchBar, ChatSearchLoadingState } from "@/components/chat/ChatSearch";
import { useChatHistorySearch } from "@/hooks/useChatHistorySearch";
import { searchChatHistory } from "@/lib/searchChatHistory";

import { PageLoading } from "@/components/ui/page-loading";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { EventPickerSheet } from "@/components/chat/EventPickerSheet";
import { BoardPickerSheet } from "@/components/chat/BoardPickerSheet";
import { CreatePollDialog } from "@/components/chat/CreatePollDialog";
import { PollAttachmentPreview } from "@/components/chat/PollAttachmentPreview";

import { ChatMessage } from "@/components/chat/ChatMessage";
import { shouldGroupWithPrev } from "@/lib/chatGrouping";
import { usePublishChatImage } from "@/hooks/usePublishChatImage";
import { PinnedMessagesBanner } from "@/components/chat/PinnedMessagesBanner";
import { PinnedVaultBanner } from "@/components/chat/PinnedVaultBanner";
import { PinVaultSheet } from "@/components/chat/PinVaultSheet";
import { useChatPinnedVault } from "@/hooks/useChatPinnedVault";
import { useClubProAccess } from "@/hooks/useClubProAccess";
import { ChatSendButton } from "@/components/chat/ChatSendButton";
import { ScheduleMessageDialog } from "@/components/chat/ScheduleMessageDialog";
import { ScheduledMessagesBanner } from "@/components/chat/ScheduledMessagesBanner";
import type { ScheduleTarget } from "@/hooks/useScheduledMessages";
import { usePinnedMessages } from "@/hooks/usePinnedMessages";
import { jumpToMessageInVirtualizedChat } from "@/lib/jumpToMessage";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";

import { useMessageReads } from "@/hooks/useMessageReads";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { fetchProfilesWithCache, fetchSingleProfileWithCache, getProfilesFromCache } from "@/lib/profileCache";
import { useProfiles } from "@/hooks/useProfiles";
import { getCachedMessages, cacheMessages, addMessageToCache, shouldRefetchMessages } from "@/lib/messageCache";
import { consumeFromNotificationFlag } from "@/lib/notificationPreload";
import { logChatOpenLatency } from "@/lib/chatOpenLatency";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { queueMessage, getQueuedMessagesForTarget } from "@/lib/messageQueue";
import { Capacitor } from "@capacitor/core";
import { useNotificationNudge } from "@/hooks/useNotificationNudge";
import { NotificationNudgeBanner } from "@/components/NotificationNudgeBanner";
import { noteChatMount, noteChatUnmount, noteChannelSubscribed, noteChannelRemoved } from "@/lib/chatPerfDiagnostics";


const MESSAGES_PER_PAGE = 30;

interface Message {
  id: string;
  club_id: string;
  author_id: string;
  text: string;
  image_url: string | null;
  reply_to_id: string | null;
  created_at: string;
  forwarded_from_user_id?: string | null;
  forwarded_at?: string | null;
  forwarded_source_label?: string | null;
  profiles: {
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  reactions: {
    id: string;
    user_id: string;
    reaction_type: string;
  }[];
  reply_to?: {
    text: string;
    profiles: { display_name: string | null } | null;
  } | null;
}

const getCachedClubMessages = (clubId: string): Message[] =>
  getCachedMessages("club", clubId).map((cachedMessage) => ({
    id: cachedMessage.id,
    club_id: clubId,
    author_id: cachedMessage.author_id,
    text: cachedMessage.text,
    image_url: cachedMessage.image_url,
    reply_to_id: cachedMessage.reply_to_id,
    created_at: cachedMessage.created_at,
    profiles: cachedMessage.profiles,
    reactions: (cachedMessage.reactions || []).map((reaction) => ({
      id: reaction.id || `cached-${cachedMessage.id}-${reaction.user_id}-${reaction.reaction_type}`,
      user_id: reaction.user_id,
      reaction_type: reaction.reaction_type,
    })),
    reply_to: cachedMessage.reply_to
      ? {
          text: cachedMessage.reply_to.text,
          profiles:
            cachedMessage.reply_to.profiles ??
            (cachedMessage.reply_to.author
              ? { display_name: cachedMessage.reply_to.author.display_name }
              : null),
        }
      : null,
  }));

export default function ClubChatPage() {
  // [chat-perf-diag] track mount/unmount lifetime
  React.useEffect(() => {
    const k = noteChatMount("ClubChat", null);
    return () => noteChatUnmount("ClubChat", k, null);
  }, []);
  const { clubId } = useParams<{ clubId: string }>();
  const { user, profile, refreshUnreadCount, decrementUnreadCount, initialized } = useAuth();
  const notificationNudge = useNotificationNudge(user?.id, "chat");
  const swipeBack = useSwipeBack();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const authReady = !!user && initialized;
  const [searchParams] = useSearchParams();
  const openedFromNotificationRef = useRef<number | null>(
    clubId ? consumeFromNotificationFlag("club", clubId) : null,
  );
  const mountTsRef = useRef<number>(Date.now());
  const perfLoggedRef = useRef<boolean>(false);
  const [message, setMessage, clearDraft] = useChatDraft(clubId);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<{ id: string; text: string; authorName: string | null } | null>(null);
  const [editingMessage, setEditingMessage] = useState<{ id: string; text: string } | null>(null);
  const [eventPickerOpen, setEventPickerOpen] = useState(false);
  const [boardPickerOpen, setBoardPickerOpen] = useState(false);
  const [pollDialogOpen, setPollDialogOpen] = useState(false);
  const [pendingPollId, setPendingPollId] = useState<string | null>(null);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const scheduleTarget: ScheduleTarget | null = clubId
    ? { chat_type: "club", club_id: clubId }
    : null;
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [pinVaultSheetOpen, setPinVaultSheetOpen] = useState(false);
  const chatReady = useChatPageReady();
  const pinnedVault = useChatPinnedVault("club", clubId ?? undefined, { enabled: chatReady });
  const { hasPro: clubHasPro, isLoading: clubProLoading } = useClubProAccess(clubId ?? null, { enabled: chatReady });
  const pinnedVaultLocked = !clubProLoading && !clubHasPro;
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  const isNativePlatform = Capacitor.isNativePlatform();
  const useVirtualizedChat = true;
  const { isOnline } = useOnlineStatus();

  // Mark club message notifications as read when opening this thread
  useEffect(() => {
    if (!user || !clubId) return;
    markChatScopeNotificationsRead({
      userId: user.id,
      scope: { kind: "club", clubId },
      queryClient,
      decrementUnreadCount,
      refreshUnreadCount,
    });
  }, [user, clubId, refreshUnreadCount, decrementUnreadCount, queryClient]);
  
  // Use ref to always get latest profile value in mutation callback
  const profileRef = useRef(profile);
  profileRef.current = profile;
  
  // Legacy DOM refs are no longer attached (Virtuoso owns scroll). Kept as
  // null refs for any non-scroll code paths that still pass them around.
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const loadTriggerRef = useRef<HTMLDivElement>(null);
  const virtualHandleRef = useRef<VirtualizedChatMessageListHandle>(null);
  const { elementRef: composerRef, height: composerHeight } = useMeasuredElementHeight<HTMLDivElement>(
    [replyingTo?.id, editingMessage?.id],
    56,
  );
  const chatHeight = useChatViewportHeight();
  const isKeyboardOpen = useKeyboardOpen();
  const nativeKbHeight = useNativeKeyboardHeight();

  const scrollToBottom = useCallback(() => {
    virtualHandleRef.current?.scrollToBottom("auto");
  }, []);

  const urlMessageId = searchParams.get("message");
  const [liveJump, setLiveJump] = useState<PendingChatJumpPayload | null>(null);
  useEffect(() => subscribePendingChatJump(setLiveJump), []);
  const liveJumpId = liveJump?.kind === "club" && liveJump.targetId === clubId ? liveJump.messageId : null;
  const urlJumpNonce = searchParams.get("jump");
  const targetJumpNonce = urlMessageId ? (urlJumpNonce ?? liveJump?.ts) : liveJumpId ? liveJump?.ts : undefined;
  const [fallbackJumpId] = useState(() =>
    clubId ? consumePendingChatJump("club", clubId) : null,
  );
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

  // Pinned messages
  const {
    pins: pinnedMessages,
    pinnedMessageIds,
    pin: pinMessage,
    unpin: unpinMessage,
    canPinMore,
  } = usePinnedMessages("club", clubId, { enabled: chatReady });
  const handleJumpToMessage = (mid: string) =>
    jumpToMessageInVirtualizedChat(
      mid,
      () => localMessagesRef.current ?? [],
      () => virtualHandleRef.current,
      setHighlightedMessageId,
      { tryLoadOlder: () => loadOlderMessagesRef.current?.() },
    );

  // Get club info
  const { data: club } = useQuery({
    queryKey: ["club", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("id, name, logo_url, is_pro")
        .eq("id", clubId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!clubId,
    staleTime: 5 * 60 * 1000,
  });

  // Sync active club to this chat's club so push-launched threads
  // don't leave the user inside the wrong club context.
  useSyncActiveClubToChat(clubId);

  // Check if user is app admin (global override)

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

  // Check if user is club admin
  const { data: isClubAdmin } = useQuery({
    queryKey: ["is-club-admin", clubId, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("club_id", clubId!)
        .eq("role", "club_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: authReady && !!clubId,
  });

  // Check for club-level subscription (Club Chat requires CLUB-level Pro, not team-level Pro)
  const { data: clubSubscription, isLoading: isLoadingClubSubscription } = useQuery({
    queryKey: ["club-subscription", clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("club_subscriptions")
        .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
        .eq("club_id", clubId!)
        .maybeSingle();
      return data;
    },
    enabled: !!clubId,
    staleTime: 5 * 60 * 1000,
  });

  // Club chat only accessible with club-level Pro subscription (not team-level Pro)
  const hasClubProAccess = clubSubscription && 
    (clubSubscription.is_pro || clubSubscription.is_pro_football || 
     clubSubscription.admin_pro_override || clubSubscription.admin_pro_football_override) && 
    (!clubSubscription.expires_at || new Date(clubSubscription.expires_at) > new Date());

  // Pro feature check: club messaging requires club-level Pro (NOT team-level Pro)
  // Note: app_admin and club_admin can still access for admin/support purposes, but the club must have Pro
  const canAccessClubChat = hasClubProAccess || club?.is_pro;

  // Force a fresh fetch whenever we land on this club chat. Push notifications
  // and inbox taps can land here while react-query still has stale data —
  // invalidating guarantees the latest message is fetched on entry.
  useEffect(() => {
    if (!clubId || !authReady) return;
    queryClient.invalidateQueries({ queryKey: ["club-messages", clubId] });
  }, [clubId, authReady, queryClient]);

  const { data: messagesData, isLoading } = useQuery({
    queryKey: ["club-messages", clubId],
    queryFn: async () => {
      // If offline, return cached messages using the shared online manager
      // so native app resume does not incorrectly fall back to stale cache.
      if (!isOnline) {
        const cached = getCachedMessages("club", clubId!);
        if (cached.length > 0) {
          // Transform cached messages to include club_id
          const messagesWithClubId = cached.map(m => ({
            ...m,
            club_id: clubId!,
            profiles: m.profiles,
            reactions: m.reactions || [],
          }));
          return { messages: messagesWithClubId as unknown as Message[], hasOlderMessages: false, fromCache: true };
        }
        throw new Error("No cached messages available offline");
      }

      // Fetch messages WITHOUT profile join to avoid timeout from large avatar_url
      const { data: rawMessages, error } = await supabase
        .from("club_messages")
        .select("id, text, image_url, created_at, author_id, club_id, reply_to_id, deleted_at, forwarded_from_user_id, forwarded_at, forwarded_source_label")
        .eq("club_id", clubId!)
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
      const authorIds = [...new Set(messagesToDisplay.map((m) => m.author_id))];

      // Preserve cached reactions when the reactions query fails transiently
      const cachedQueryData = queryClient.getQueryData(["club-messages", clubId]) as any;
      const cachedMessages: Message[] = Array.isArray(cachedQueryData)
        ? cachedQueryData
        : cachedQueryData?.messages || [];
      const cachedReactionsByMessage = new Map<string, Message["reactions"]>();
      cachedMessages.forEach((cm) => {
        if (cm.reactions?.length) cachedReactionsByMessage.set(cm.id, cm.reactions);
      });

      const [reactionsResult, replyToResult, profilesMap] = await Promise.all([
        supabase
          .from("message_reactions")
          .select("id, user_id, reaction_type, club_message_id")
          .in("club_message_id", messageIds),
        replyToIds.length > 0
          ? supabase
              .from("club_messages")
              .select("id, text, author_id")
              .in("id", replyToIds)
          : Promise.resolve({ data: [] as any[] }),
        fetchProfilesWithCache(authorIds),
      ]);

      if (reactionsResult.error) {
        console.warn("[ClubChat] Failed to fetch reactions, keeping cached reactions", reactionsResult.error);
      }

      const replyToMap = new Map(
        (replyToResult.data || []).map((r: any) => [r.id, {
          ...r,
          profiles: profilesMap.get(r.author_id) ? { display_name: profilesMap.get(r.author_id)?.display_name } : null,
        }])
      );

      // Map to expected format - use fetched profiles
      const messages = messagesToDisplay.map((msg: any) => {
        const replyTo = msg.reply_to_id ? replyToMap.get(msg.reply_to_id) || null : null;
        const profile = profilesMap.get(msg.author_id);
        const reactions = reactionsResult.error
          ? cachedReactionsByMessage.get(msg.id) || []
          : reactionsResult.data?.filter((r) => r.club_message_id === msg.id) || [];
        return {
          id: msg.id,
          club_id: msg.club_id,
          author_id: msg.author_id,
          text: msg.text,
          image_url: msg.image_url,
          reply_to_id: msg.reply_to_id,
          created_at: msg.created_at,
          profiles: profile ? { display_name: profile.display_name, avatar_url: profile.avatar_url } : null,
          reactions,
          reply_to: replyTo,
        };
      }) as Message[];

      // Cache messages for offline access
      cacheMessages("club", clubId!, messages.map(m => ({
        id: m.id,
        text: m.text,
        author_id: m.author_id,
        created_at: m.created_at,
        image_url: m.image_url,
        reply_to_id: m.reply_to_id,
        profiles: m.profiles,
        reactions: m.reactions,
        reply_to: m.reply_to,
      })));

      return { messages, hasOlderMessages: hasMore };
    },
    enabled: !!clubId && !!user?.id, // session token is sufficient; don't wait for profile fetch (`authReady`) to unblock first paint
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    placeholderData: (prev: any) => {
      if (!clubId) return prev;
      // From-push freshness: prefer the just-preloaded localStorage cache
      // over a stale `prev` so the new message renders at first paint.
      if (openedFromNotificationRef.current) {
        const cachedMessages = getCachedClubMessages(clubId);
        if (cachedMessages.length) {
          return { messages: cachedMessages, hasOlderMessages: isOnline && cachedMessages.length > 0, fromCache: true };
        }
      }
      if (prev) return prev;

      const cachedMessages = getCachedClubMessages(clubId);
      if (!cachedMessages.length) return undefined;

      return { messages: cachedMessages, hasOlderMessages: isOnline && cachedMessages.length > 0, fromCache: true };
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
  const [localMessages, setLocalMessages] = useState<Message[] | undefined>(() =>
    clubId ? getCachedClubMessages(clubId) : undefined,
  );
  const [infiniteScrollEnabled, setInfiniteScrollEnabled] = useState(false);
  const showLoading =
    (!authReady && !(localMessages?.length)) ||
    (isLoading && !messagesData && !(localMessages?.length));

  // Log notification-tap → first-message-render latency once per mount.
  useEffect(() => {
    if (perfLoggedRef.current) return;
    if (!clubId || !user?.id) return;
    if (showLoading) return;
    if (!localMessages || localMessages.length === 0) return;
    perfLoggedRef.current = true;
    const tapTs = openedFromNotificationRef.current;
    void logChatOpenLatency({
      kind: "club",
      targetId: clubId,
      source: tapTs ? "notification" : "cold_open",
      startTs: tapTs ?? mountTsRef.current,
      messageCount: localMessages.length,
      fromCache: !messagesData,
      userId: user.id,
    });
  }, [clubId, user?.id, showLoading, localMessages, messagesData]);
  
  // Use fresh profile data that refreshes on visibility change (fixes names vanishing after phone lock)
  const authorIds = useMemo(() => {
    return [...new Set((localMessages || []).map(m => m.author_id).filter(Boolean))];
  }, [localMessages]);
  const { getProfile } = useProfiles(authorIds);
  
  // Reset scroll state when clubId changes
  useEffect(() => {
    setLocalMessages(clubId ? getCachedClubMessages(clubId) : undefined);
    setInfiniteScrollEnabled(false);
  }, [clubId]);

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
    await queryClient.invalidateQueries({ queryKey: ["club-messages", clubId] });
  }, [queryClient, clubId]);

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
    if (!messages || !clubId || (messages.length === 0 && localMessages && localMessages.length > 0)) return;

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

            // Trust incoming cache state for real reactions (so removals apply instantly),
            // but keep any local temp reactions not yet confirmed by realtime/DB.
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

      cacheMessages("club", clubId, mergedMessages.map((m) => ({
        id: m.id,
        text: m.text,
        author_id: m.author_id,
        created_at: m.created_at,
        image_url: m.image_url,
        reply_to_id: m.reply_to_id,
        profiles: m.profiles,
        reactions: m.reactions,
        reply_to: m.reply_to,
      })));

      return mergedMessages;
    });
  }, [messages, clubId]);

  // If messages unexpectedly dropped to 0 but we had cached messages, trigger a refetch
  useEffect(() => {
    if (!clubId || !authReady || isLoading) return;
    
    const fetchedCount = messages?.length ?? 0;
    if (shouldRefetchMessages("club", clubId, fetchedCount)) {
      console.log("[ClubChat] Messages unexpectedly 0, triggering refetch");
      queryClient.invalidateQueries({ queryKey: ["club-messages", clubId] });
    }
  }, [clubId, authReady, messages, isLoading, queryClient]);

  // Visibility change handler - refetch messages and profiles when app becomes visible (e.g., phone unlock)
  useEffect(() => {
    let lastRefresh = Date.now();
    
    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible" && clubId && authReady) {
        const timeSinceLastRefresh = Date.now() - lastRefresh;
        // Only refresh if it's been more than 30 seconds
        if (timeSinceLastRefresh > 30000) {
          console.log("[ClubChat] App became visible, refreshing messages");
          lastRefresh = Date.now();
          await queryClient.invalidateQueries({ queryKey: ["club-messages", clubId] });
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [clubId, authReady, queryClient]);

  // Always ensure profiles are loaded for messages with missing profile data
  useEffect(() => {
    if (!localMessages?.length) return;
    
    // Find messages with missing profile data
    const messagesWithMissingProfiles = localMessages.filter(m => !m.profiles?.display_name);
    if (messagesWithMissingProfiles.length === 0) return;
    
    const authorIds = [...new Set(messagesWithMissingProfiles.map(m => m.author_id).filter(Boolean))];
    if (authorIds.length === 0) return;
    
    // Fetch profiles and update local state
    fetchProfilesWithCache(authorIds).then(profilesMap => {
      setLocalMessages(prev => {
        if (!prev) return prev;
        let updated = false;
        const newMessages = prev.map(msg => {
          const profile = profilesMap.get(msg.author_id);
          if (profile && (!msg.profiles?.display_name || msg.profiles.display_name === "Unknown")) {
            updated = true;
            return {
              ...msg,
              profiles: { display_name: profile.display_name, avatar_url: profile.avatar_url },
            };
          }
          return msg;
        });
        return updated ? newMessages : prev;
      });
    });
  }, [localMessages]);

  useEffect(() => {
    if (messagesData && !Array.isArray(messagesData)) {
      const data = messagesData as any;
      const messageCount = Array.isArray(data.messages) ? data.messages.length : 0;
      setHasOlderMessages(data.fromCache ? isOnline && messageCount > 0 : data.hasOlderMessages ?? false);
    }
  }, [messagesData, isOnline]);

  // Keep a ref to localMessages so loadOlderMessages doesn't churn
  const localMessagesRef = useRef<Message[] | undefined>(localMessages);
  useEffect(() => {
    localMessagesRef.current = localMessages;
  }, [localMessages]);

  // Forward ref so the anchor hook can call the loader defined below.
  const loadOlderMessagesRef = useRef<(() => void) | null>(null);

  // Virtuoso owns scroll-anchoring on prepend natively. No DOM scrollTop math.
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
        .from("club_messages")
        .select("id, text, image_url, created_at, author_id, club_id, reply_to_id, forwarded_from_user_id, forwarded_at, forwarded_source_label")
        .eq("club_id", clubId!)
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
      const authorIds = [...new Set(reversedOlder.map((m) => m.author_id))];

      // Fetch reactions, reply-to messages, and profiles
      let reactionsData: any[] = [];
      let replyToData: any[] = [];
      let profilesMap = new Map<string, { display_name: string | null; avatar_url: string | null }>();
      
      try {
        const secondaryController = new AbortController();
        const secondaryTimeout = setTimeout(() => secondaryController.abort(), 5000);
        
        const [reactionsResult, replyToResult, cachedProfiles] = await Promise.all([
          supabase
            .from("message_reactions")
            .select("id, user_id, reaction_type, club_message_id")
            .in("club_message_id", messageIds)
            .abortSignal(secondaryController.signal),
          replyToIds.length > 0 
            ? supabase
                .from("club_messages")
                .select("id, text, author_id")
                .in("id", replyToIds)
                .abortSignal(secondaryController.signal)
            : Promise.resolve({ data: [] as any[], error: null }),
          fetchProfilesWithCache(authorIds),
        ]);
        
        clearTimeout(secondaryTimeout);
        reactionsData = reactionsResult.data || [];
        replyToData = replyToResult.data || [];
        cachedProfiles.forEach((p, id) => {
          profilesMap.set(id, { display_name: p.display_name, avatar_url: p.avatar_url });
        });
      } catch {
        // Continue without reactions/replies/profiles if they timeout
      }

      const olderMessages = reversedOlder.map((msg) => ({
        ...msg,
        profiles: profilesMap.get(msg.author_id) || null,
        reactions: reactionsData.filter((r) => r.club_message_id === msg.id) || [],
        reply_to: replyToData.find((r) => r.id === msg.reply_to_id) || null,
      })) as Message[];

      // Prepend older messages to cache + restore scroll anchor synchronously
      // (no jolt). The hook flushSyncs the cache update and corrects scrollTop
      // in the same task.
      queueAnchoredPrepend(() => {
        queryClient.setQueryData(["club-messages", clubId], (old: any) => {
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
  }, [clubId, queryClient, isLoadingOlder, hasOlderMessages, queueAnchoredPrepend]);

  // Keep the loader ref in sync for the anchor hook to call.
  useEffect(() => {
    loadOlderMessagesRef.current = loadOlderMessages;
  }, [loadOlderMessages]);

  // Realtime subscription - directly update cache instead of invalidating
  useEffect(() => {
    if (!clubId) return;

    const channel = supabase
      .channel(`club-messages-${clubId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "club_messages",
          filter: `club_id=eq.${clubId}`,
        },
        (payload) => {
          const newMsg = payload.new as any;
          
          // Get cached profile synchronously (instant, non-blocking)
          const { cached: cachedProfiles } = getProfilesFromCache([newMsg.author_id]);
          const cachedProfile = cachedProfiles.get(newMsg.author_id);
          
          // IMMEDIATELY update cache with message (don't wait for profile fetch)
          queryClient.setQueryData(["club-messages", clubId], (old: any) => {
            const existingMessages: Message[] = old?.messages || [];
            
            // Check if message already exists with real ID
            if (existingMessages.some(m => m.id === newMsg.id)) {
              return old;
            }
            
            // Check for temp message to replace
            const tempIndex = existingMessages.findIndex(
              m => m.id.startsWith('temp-') && m.author_id === newMsg.author_id
            );
            
            const messageToAdd: Message = {
              ...newMsg,
              profiles: cachedProfile 
                ? { display_name: cachedProfile.display_name, avatar_url: cachedProfile.avatar_url }
                : null,
              reactions: [],
              reply_to: null,
            };
            
            if (tempIndex !== -1) {
              // Replace temp message with real one, preserving profile from temp message
              const updatedMessages = [...existingMessages];
              updatedMessages[tempIndex] = {
                ...messageToAdd,
                profiles: messageToAdd.profiles?.display_name 
                  ? messageToAdd.profiles 
                  : existingMessages[tempIndex].profiles,
                reply_to: existingMessages[tempIndex].reply_to,
              };
              return { ...old, messages: updatedMessages };
            }
            
            // Add new message (from other user)
            const updatedMessages = [...existingMessages, messageToAdd].sort(
              (a, b) => (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) || a.id.localeCompare(b.id)
            );
            return { ...old, messages: updatedMessages };
          });
          
          // Asynchronously fetch profile and reply_to data if needed, then update
          const needsProfileFetch = !cachedProfile;
          const needsReplyFetch = !!newMsg.reply_to_id;
          
          if (needsProfileFetch || needsReplyFetch) {
            Promise.all([
              needsProfileFetch 
                ? fetchSingleProfileWithCache(newMsg.author_id)
                : Promise.resolve(cachedProfile),
              needsReplyFetch
                ? supabase
                    .from("club_messages")
                    .select("text, profiles:author_id(display_name)")
                    .eq("id", newMsg.reply_to_id)
                    .single()
                : Promise.resolve({ data: null }),
            ]).then(([profileData, replyToResult]) => {
              // Update the message with fetched data
              queryClient.setQueryData(["club-messages", clubId], (old: any) => {
                const existingMessages: Message[] = old?.messages || [];
                return {
                  ...(old || {}),
                  messages: existingMessages.map(m => {
                    if (m.id !== newMsg.id) return m;
                    return {
                      ...m,
                      profiles: profileData 
                        ? { display_name: profileData.display_name, avatar_url: profileData.avatar_url }
                        : m.profiles,
                      reply_to: replyToResult?.data
                        ? { text: replyToResult.data.text, profiles: replyToResult.data.profiles }
                        : m.reply_to,
                    };
                  }),
                };
              });
            });
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "club_messages",
          filter: `club_id=eq.${clubId}`,
        },
        (payload) => {
          const deletedId = (payload.old as any).id;
          queryClient.setQueryData(["club-messages", clubId], (old: any) => {
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
          table: "club_messages",
          filter: `club_id=eq.${clubId}`,
        },
        (payload) => {
          const updated = payload.new as any;
          queryClient.setQueryData(["club-messages", clubId], (old: any) => {
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
          if (!reaction.club_message_id) return;
          queryClient.setQueryData(["club-messages", clubId], (old: any) => {
            const existingMessages: Message[] = old?.messages || [];
            const updatedMessages = existingMessages.map(m => {
              if (m.id !== reaction.club_message_id) return m;
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
          if (!reaction.club_message_id) return;
          queryClient.setQueryData(["club-messages", clubId], (old: any) => {
            const existingMessages: Message[] = old?.messages || [];
            const updatedMessages = existingMessages.map(m => {
              if (m.id !== reaction.club_message_id) return m;
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
          queryClient.setQueryData(["club-messages", clubId], (old: any) => {
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
    noteChannelSubscribed(`club-messages-${clubId}`);

    return () => {
      supabase.removeChannel(channel); noteChannelRemoved(`club-messages-${clubId}`);
    };
  }, [clubId, queryClient]);

  const handleReply = useCallback((m: { id: string; text: string; authorName: string | null }) => {
    // Don't allow replying to optimistic or queued messages (temp/queued IDs)
    if (m.id.startsWith('temp-') || m.id.startsWith('queued-')) {
      toast({ title: "Please wait for the message to be sent before replying", variant: "destructive" });
      return;
    }
    setReplyingTo(m);
    setTimeout(() => virtualHandleRef.current?.scrollToBottom("auto"), 100);
  }, [toast, scrollToBottom]);

  const queryKeyMemo = useMemo(() => ["club-messages", clubId!], [clubId]);

  const formatTimestamp = useCallback((dateStr: string) => {
    return format(parseISO(dateStr), "MMM d, h:mm a");
  }, []);

  const sendMutation = useMutation({
    mutationFn: async ({ text, image_url, reply_to_id }: { text: string; image_url: string | null; reply_to_id: string | null }) => {
      // If offline, queue the message
      if (!navigator.onLine) {
        queueMessage({
          type: "club",
          targetId: clubId!,
          authorId: user!.id,
          text,
          imageUrl: image_url,
          replyToId: reply_to_id,
          createdAt: new Date().toISOString(),
        });
        return;
      }
      
      const { error } = await supabase.from("club_messages").insert({
        text,
        club_id: clubId!,
        author_id: user!.id,
        image_url,
        reply_to_id,
      });
      if (error) throw error;
    },
    onMutate: async ({ text, image_url, reply_to_id }) => {
      const currentProfile = profileRef.current;
      await queryClient.cancelQueries({ queryKey: ["club-messages", clubId] });

      const previousData = queryClient.getQueryData(["club-messages", clubId]);

      const optimisticMessage: Message = {
        id: `temp-${Date.now()}`,
        club_id: clubId!,
        author_id: user!.id,
        text,
        image_url,
        reply_to_id,
        created_at: new Date().toISOString(),
        profiles: {
          display_name: currentProfile?.display_name || "You",
          avatar_url: currentProfile?.avatar_url || null,
        },
        reactions: [],
        reply_to: replyingTo ? { text: replyingTo.text, profiles: { display_name: replyingTo.authorName } } : null,
      };

      // Update query cache directly (this will sync to localMessages via useEffect)
      queryClient.setQueryData(["club-messages", clubId], (old: any) => {
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
        queryClient.setQueryData(["club-messages", clubId], context.previousData);
      }
      toast({
        title: "Failed to send message",
        variant: "destructive",
      });
    },
    onSettled: (_, __, variables) => {
      // Don't invalidate here; realtime will sync messages
      // Award engagement points (fire and forget)
      if (user && clubId) {
        import("@/lib/engagementPoints").then(({ awardEngagementPoints }) => {
          awardEngagementPoints({
            userId: user.id,
            clubId: clubId,
            action: "chat_message",
            scopeId: clubId,
          }).catch(() => {});
        });
        // Auto-sync attachments/file links to vault (fire and forget)
        if (variables?.image_url || variables?.text) {
          import("@/lib/chatVaultSync").then(({ syncChatAttachmentToVault }) => {
            syncChatAttachmentToVault({
              imageUrl: variables.image_url,
              text: variables.text,
              userId: user.id,
              clubId: clubId,
            }).catch(() => {});
          });
        }
      }
    },
   });

  const updateMessageMutation = useMutation({
    mutationFn: async () => {
      if (!editingMessage) return;
      const { error } = await supabase.from("club_messages").update({ text: message.trim() }).eq("id", editingMessage.id);
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

  const {
    publishingIds: galleryPublishingIds,
    publishedIds: galleryPublishedIds,
    publish: handlePublishToGallery,
    nudgeAfterSend: nudgeGalleryAfterSend,
  } = usePublishChatImage({
    uploaderId: user?.id,
    teamId: null,
    clubId: clubId ?? null,
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
    const hadImage = !!imageUrl;
    sendMutation.mutate({ text: finalText, image_url: imageUrl, reply_to_id: replyingTo?.id || null });
    if (hadImage) nudgeGalleryAfterSend();
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
    enabled: !!clubId,
    cacheKey: `club:${clubId ?? ""}`,
    fetcher: async (q, signal) =>
      (await searchChatHistory({
        table: "club_messages",
        scope: { club_id: clubId! },
        query: q,
        signal,
        selectColumns: "id, text, image_url, created_at, author_id, club_id, reply_to_id, forwarded_from_user_id, forwarded_at, forwarded_source_label",
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
    "club",
    clubId || "",
    messageIds,
    user?.id
  );

  // Typing indicator
  const { typingUsers, startTyping, stopTyping } = useTypingIndicator(
    `club-${clubId}`,
    user?.id,
    profile?.display_name || undefined
  );

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

  // Live online count for the club — only shown in the header sublabel when > 0.
  const clubOnlineCount = useChatOnlineCount("club", clubId, { enabled: chatReady });
  const clubHeaderSublabel = clubOnlineCount > 0
    ? `Club chat · ${clubOnlineCount} online`
    : "Club chat";

  if (isLoadingClubSubscription && !club) {
    return <PageLoading message="Loading club chat..." />;
  }

  // Block access for non-Pro users - show full page blocker
  if (!isLoadingClubSubscription && !canAccessClubChat) {
  return (
    <div className="flex flex-col" style={{ height: chatHeight, paddingBottom: "calc(var(--bottom-nav-offset, 0px) + 1rem)" }}>
        <div className="flex items-center gap-3 px-4 py-3 border-b bg-card shrink-0">
          <Button variant="ghost" size="icon" onClick={() => navigate("/messages")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <Avatar className="h-10 w-10">
            <AvatarImage src={club?.logo_url || undefined} />
            <AvatarFallback className="bg-secondary text-secondary-foreground">
              {club?.name?.charAt(0)?.toUpperCase() || "C"}
            </AvatarFallback>
          </Avatar>
        <div className="flex-1">
            <h1 className="font-semibold">{club?.name || "Club"}</h1>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center py-12 px-4">
            <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-lg font-medium text-foreground mb-2">Club Pro Feature</p>
            <p className="text-muted-foreground">Club chat is available with a Club Pro subscription</p>
            <p className="text-sm text-muted-foreground mt-1">
              Contact your club admin to upgrade the club to Pro for club-wide messaging
            </p>
            <Button 
              variant="outline" 
              className="mt-4"
              onClick={() => navigate(`/clubs/${clubId}/upgrade`)}
            >
              View Upgrade Options
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col overflow-hidden overscroll-none" style={{ height: chatHeight }} data-lock-keyboard-scroll="true" onTouchStart={swipeBack.onTouchStart} onTouchEnd={swipeBack.onTouchEnd}>
      {/* Header */}
      <ChatHeaderShell
        type="club"
        name={club?.name || "Club"}
        sublabel={clubHeaderSublabel}
        avatarUrl={club?.logo_url}
        onOpenDetails={() => setMembersOpen(true)}
        leftSlot={
          <ChatSearchBar onSearch={setSearchQuery} isOpen={searchOpen} onOpenChange={setSearchOpen} isSearching={isSearchFetching} />
        }
        rightSlot={
          <>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSearchOpen(true)}>
              <Search className="h-4 w-4" />
            </Button>
            <ChatHeaderMenu
              onRefresh={handleManualRefresh}
              isRefreshing={isAnyRefreshing}
              onManagePinnedVault={
                (isClubAdmin || isAppAdmin)
                  ? () => {
                      if (pinnedVaultLocked) {
                        toast({ title: "Pinned vault is a Pro feature" });
                        if (clubId) navigate(`/clubs/${clubId}/upgrade`);
                        return;
                      }
                      setPinVaultSheetOpen(true);
                    }
                  : undefined
              }
              pinnedVaultLocked={!!(isClubAdmin || isAppAdmin) && pinnedVaultLocked}
              pinnedVaultEnabled={pinnedVault.record ? pinnedVault.record.enabled : null}
              onTogglePinnedVault={
                pinnedVault.record && (isClubAdmin || isAppAdmin) && !pinnedVaultLocked
                  ? (v) => pinnedVault.toggleEnabled(v)
                  : undefined
              }
            />
          </>
        }
      />
      <ChatDetailsSheet
        open={membersOpen}
        onOpenChange={setMembersOpen}
        chatType="club"
        chatId={clubId!}
        name={club?.name || "Club"}
        sublabel="Club chat"
        avatarUrl={club?.logo_url}
      />


      {/* Notification Nudge */}
      {notificationNudge.shouldShowNudge && (
        <div className="px-4 pt-2 shrink-0">
          <NotificationNudgeBanner
            message="Enable notifications so you never miss club announcements"
            onDismiss={notificationNudge.dismiss}
            userId={user?.id}
          />
        </div>
      )}

      {/* Pinned vault banner */}
      <PinnedVaultBanner
        record={pinnedVault.record}
        isAdmin={!!(isClubAdmin || isAppAdmin)}
        onUnpin={
          pinnedVault.record && (isClubAdmin || isAppAdmin || pinnedVault.record.set_by === user?.id)
            ? () => pinnedVault.remove()
            : undefined
        }
      />

      {/* Pinned messages banner */}
      <PinnedMessagesBanner
        pins={pinnedMessages}
        onJumpToMessage={handleJumpToMessage}
        onUnpin={unpinMessage}
      />

      {clubId && (
        <PinVaultSheet
          open={pinVaultSheetOpen}
          onOpenChange={setPinVaultSheetOpen}
          chatType="club"
          chatId={clubId}
          clubId={clubId}
        />
      )}

      <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden overscroll-none">
        {isLoadingClubSubscription ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-3/4" />
            ))}
          </div>
        ) : showLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-3/4" />
            ))}
          </div>
        ) : (isSearchFetching || (!!searchQuery && !searchCanShowEmpty)) ? (
          <ChatSearchLoadingState />
        ) : filteredMessages?.length === 0 ? (
          <ChatEmptyState
            title="No announcements yet"
            subtitle={isClubAdmin ? "Send the first message to all club members" : undefined}
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
                      authorName={getProfile(msg.author_id)?.display_name || msg.profiles?.display_name || null}
                      authorAvatar={getProfile(msg.author_id)?.avatar_url || msg.profiles?.avatar_url || null}
                      timestamp={formatTimestamp(msg.created_at)}
                      isOwn={msg.author_id === user?.id}
                      isAdmin={isClubAdmin || isAppAdmin || false}
                      reactions={msg.reactions}
                      currentUserId={user?.id}
                      messageType="club"
                      queryKey={queryKeyMemo}
                      replyToMessage={
                        msg.reply_to
                          ? { text: msg.reply_to.text, authorName: msg.reply_to.profiles?.display_name || null }
                          : null
                      }
                      hasReply={!!msg.reply_to_id}
                      onReply={handleReply}
                      onEdit={handleEdit}
                      searchQuery={searchQuery}
                      readFrontierReaders={readFrontier[msg.id] || []}
                      readCount={readCounts[msg.id] || 0}
                      isLastMessage={index === arr.length - 1}
                      isPending={msg.id.startsWith("queued-")}
                      contextId={clubId || ""}
                      isPinned={pinnedMessageIds.has(msg.id)}
                      canPin={!msg.id.startsWith("queued-")}
                      pinLimitReached={!canPinMore && !pinnedMessageIds.has(msg.id)}
                      onPin={pinMessage}
                      onUnpin={unpinMessage}
                      canPublishToGallery={msg.author_id === user?.id && !!msg.image_url && !msg.id.startsWith("queued-")}
                      isPublishingToGallery={galleryPublishingIds.has(msg.id)}
                      isPublishedToGallery={galleryPublishedIds.has(msg.id)}
                      onPublishToGallery={handlePublishToGallery}
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

      {/* Input (for users with Pro access: app_admin, club admin, or Pro team member) */}
      {canAccessClubChat && (
        <>
        <div className="fixed left-0 right-0 bg-background z-[49] pointer-events-none" style={{ bottom: nativeKbHeight, height: nativeKbHeight > 0 ? "3rem" : "calc(var(--bottom-nav-offset, 0px) + 3rem)" }} />
        <div ref={composerRef} data-chat-chrome="true" className="fixed left-0 right-0 w-full max-w-full overflow-visible border-t border-border/30 pt-1 pb-2 px-2 bg-background/95 z-[51]" style={{ bottom: nativeKbHeight > 0 ? nativeKbHeight : "var(--bottom-nav-offset, 0px)" }}>
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
          {scheduleTarget && <ScheduledMessagesBanner target={scheduleTarget} />}
          <ChatComposerShell>
            <ChatImageInput
              imageUrl={imageUrl}
              onImageUploaded={setImageUrl}
              disabled={false}
              clubId={clubId}
              showEventPicker={true}
              onEventSelect={() => setEventPickerOpen(true)}
              showPollCreator={true}
              onPollCreate={() => setPollDialogOpen(true)}
              showBoardPicker={false}
              onBoardPick={() => setBoardPickerOpen(true)}
              showVaultPicker={true}
              onAppendToken={(token) => setMessage((prev) => (prev ? `${prev} ${token}` : token))}
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
              clubId={clubId}
              onGifSelect={setImageUrl}
            />
            <ChatSendButton
              onSend={() => {
                stopTyping();
                handleSend();
              }}
              onSchedule={scheduleTarget ? () => setScheduleDialogOpen(true) : undefined}
              disabled={!message.trim() && !imageUrl && !pendingPollId}
              loading={sendMutation.isPending}
              canSend={!!message.trim() || !!imageUrl || !!pendingPollId}
            />
          </ChatComposerShell>
          {scheduleTarget && (
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
          )}
          <EventPickerSheet
            open={eventPickerOpen}
            onOpenChange={setEventPickerOpen}
            onSelectEvent={(eventId) => {
              const token = `[event:${eventId}]`;
              setMessage(message ? `${message} ${token}` : token);
            }}
            clubId={clubId}
          />
          <BoardPickerSheet
            open={boardPickerOpen}
            onOpenChange={setBoardPickerOpen}
            onSelectBoard={(gameId) => {
              const token = `[board:${gameId}]`;
              setMessage(message ? `${message} ${token}` : token);
            }}
          />
          {clubId && (
            <CreatePollDialog
              open={pollDialogOpen}
              onOpenChange={setPollDialogOpen}
              chatType="club"
              chatId={clubId}
              onCreated={(pollId) => setPendingPollId(pollId)}
            />
          )}
        </div>
        </>
      )}
    </div>
  );
}
