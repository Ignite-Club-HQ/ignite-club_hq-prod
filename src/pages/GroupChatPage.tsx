import React, { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from "react";
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
import { supabase } from "@/integrations/supabase/client";
import { ensureFreshSession, isAuthLikeError } from "@/lib/ensureFreshSession";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { MentionInput } from "@/components/chat/MentionInput";
import { ArrowLeft, Send, MoreVertical, Pencil, Trash2, Reply, SmilePlus, Loader2, Clock, Users, Search } from "lucide-react";
import { ChatBackButton } from "@/components/chat/ChatBackButton";
import { useSwipeBack } from "@/hooks/useSwipeBack";
import { ChatHeaderShell } from "@/components/chat/ChatHeaderShell";
import { ChatDetailsSheet } from "@/components/chat/ChatDetailsSheet";
import { ChatHeaderMenu } from "@/components/chat/ChatHeaderMenu";
import { useChatOnlineCount } from "@/hooks/useChatOnlineCount";
import { ChatSearchBar, ChatSearchLoadingState } from "@/components/chat/ChatSearch";
import { useChatHistorySearch } from "@/hooks/useChatHistorySearch";
import { searchChatHistory } from "@/lib/searchChatHistory";

import { PageLoading } from "@/components/ui/page-loading";
import EditGroupDialog from "@/components/chat/EditGroupDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";


const MESSAGES_PER_PAGE = 30;
import { toast } from "sonner";
import { ChatImageInput } from "@/components/chat/ChatImageInput";
// EmojiPicker is built into MentionInput
import { ReplyPreview } from "@/components/chat/ReplyPreview";
import { EventPickerSheet } from "@/components/chat/EventPickerSheet";
import { BoardPickerSheet } from "@/components/chat/BoardPickerSheet";
import { CreatePollDialog } from "@/components/chat/CreatePollDialog";
import { PollAttachmentPreview } from "@/components/chat/PollAttachmentPreview";
import { GroupChatMessageRow } from "@/components/chat/GroupChatMessageRow";
import { usePublishChatImage } from "@/hooks/usePublishChatImage";
import { PinnedMessagesBanner } from "@/components/chat/PinnedMessagesBanner";
import { PinnedVaultBanner } from "@/components/chat/PinnedVaultBanner";
import { PinVaultSheet } from "@/components/chat/PinVaultSheet";
import { useChatPinnedVault } from "@/hooks/useChatPinnedVault";
import { ChatSendButton } from "@/components/chat/ChatSendButton";
import { ScheduleMessageDialog } from "@/components/chat/ScheduleMessageDialog";
import { ScheduledMessagesBanner } from "@/components/chat/ScheduledMessagesBanner";
import type { ScheduleTarget } from "@/hooks/useScheduledMessages";
import { usePinnedMessages } from "@/hooks/usePinnedMessages";
import { jumpToMessageInVirtualizedChat } from "@/lib/jumpToMessage";

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
import { MessageReadAvatars } from "@/components/chat/MessageReadAvatars";
import { fetchProfilesWithCache, fetchSingleProfileWithCache, getProfilesFromCache } from "@/lib/profileCache";
import { useProfiles } from "@/hooks/useProfiles";
import { getCachedMessages, cacheMessages, addMessageToCache, shouldRefetchMessages, removeMessageFromCache } from "@/lib/messageCache";
import { consumeFromNotificationFlag } from "@/lib/notificationPreload";
import { logChatOpenLatency } from "@/lib/chatOpenLatency";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { queueMessage, getQueuedMessagesForTarget } from "@/lib/messageQueue";
import { Capacitor } from "@capacitor/core";
import { useNotificationNudge } from "@/hooks/useNotificationNudge";
import { NotificationNudgeBanner } from "@/components/NotificationNudgeBanner";
import { noteChatMount, noteChatUnmount, noteChannelSubscribed, noteChannelRemoved } from "@/lib/chatPerfDiagnostics";



const REACTION_EMOJIS = ["👍", "❤️", "🔥", "👏", "😂", "😢"];

const GROUP_REACTION_EMOJI_MAP: Record<string, string> = {
  "❤️": "❤️",
  "🔥": "🔥",
  "👏": "👏",
  "😂": "😂",
  "👍": "👍",
  "😢": "😢",
  like: "❤️",
  fire: "🔥",
  clap: "👏",
  laugh: "😂",
  thumbsup: "👍",
  sad: "😢",
};

const normalizeGroupReactionType = (reactionType?: string | null) => {
  if (!reactionType) return "";
  return GROUP_REACTION_EMOJI_MAP[reactionType] || reactionType;
};

interface GroupMessage {
  id: string;
  text: string;
  image_url: string | null;
  created_at: string;
  author_id: string;
  group_id: string;
  reply_to_id: string | null;
  is_system_message?: boolean;
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

interface ChatGroup {
  id: string;
  name: string;
  club_id: string | null;
  team_id: string | null;
  mini_league_id: string | null;
  allowed_roles: string[];
  created_by: string;
  membership_mode: string | null;
}

interface MessageReaction {
  id: string;
  user_id: string;
  reaction_type: string;
  group_message_id: string | null;
}

const getCachedGroupMessages = (groupId: string) => {
  const cachedMessages = getCachedMessages("group", groupId);

  const messages = cachedMessages.map((cachedMessage) => ({
    id: cachedMessage.id,
    text: cachedMessage.text,
    image_url: cachedMessage.image_url,
    created_at: cachedMessage.created_at,
    author_id: cachedMessage.author_id,
    group_id: groupId,
    reply_to_id: cachedMessage.reply_to_id,
    author: cachedMessage.profiles
      ? {
          display_name: cachedMessage.profiles.display_name,
          avatar_url: cachedMessage.profiles.avatar_url,
        }
      : null,
    reply_to: cachedMessage.reply_to
      ? {
          text: cachedMessage.reply_to.text,
          author: cachedMessage.reply_to.author ?? cachedMessage.reply_to.profiles ?? null,
        }
      : null,
  })) as GroupMessage[];

  const reactions = cachedMessages.flatMap((cachedMessage) =>
    (cachedMessage.reactions || []).map((reaction) => ({
      id: reaction.id || `cached-${cachedMessage.id}-${reaction.user_id}-${reaction.reaction_type}`,
      user_id: reaction.user_id,
      reaction_type: reaction.reaction_type,
      group_message_id: cachedMessage.id,
    })),
  ) as MessageReaction[];

  return { messages, reactions };
};

export default function GroupChatPage() {
  // [chat-perf-diag] track mount/unmount lifetime
  React.useEffect(() => {
    const k = noteChatMount("GroupChat", null);
    return () => noteChatUnmount("GroupChat", k, null);
  }, []);
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, profile, refreshUnreadCount, initialized } = useAuth();
  const notificationNudge = useNotificationNudge(user?.id, "chat");
  const swipeBack = useSwipeBack();
  const queryClient = useQueryClient();
  const authReady = !!user && initialized;
  const openedFromNotificationRef = useRef<number | null>(
    groupId ? consumeFromNotificationFlag("group", groupId) : null,
  );
  const mountTsRef = useRef<number>(Date.now());
  const perfLoggedRef = useRef<boolean>(false);
  const [message, setMessage, clearDraft] = useChatDraft(groupId);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const scheduleTarget: ScheduleTarget | null = groupId
    ? { chat_type: "group", group_id: groupId }
    : null;
  const [replyTo, setReplyTo] = useState<GroupMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<GroupMessage | null>(null);
  const [eventPickerOpen, setEventPickerOpen] = useState(false);
  const [boardPickerOpen, setBoardPickerOpen] = useState(false);
  const [pollDialogOpen, setPollDialogOpen] = useState(false);
  const [pendingPollId, setPendingPollId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [showEditGroupDialog, setShowEditGroupDialog] = useState(false);
  const [pinVaultSheetOpen, setPinVaultSheetOpen] = useState(false);
  const pinnedVault = useChatPinnedVault("group", groupId);
  const [showDeleteGroupDialog, setShowDeleteGroupDialog] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const useVirtualizedChat = true;
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  const isNativePlatform = Capacitor.isNativePlatform();

  // Mark group message notifications as read when opening this thread
  useEffect(() => {
    if (!user || !groupId) return;
    
    const markNotificationsAsRead = async () => {
      await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", user.id)
        .eq("type", "group_message")
        .eq("is_read", false);
      
      // Refresh unread counts
      refreshUnreadCount();
      queryClient.invalidateQueries({ queryKey: ["unread-message-counts"] });
    };
    
    markNotificationsAsRead();
  }, [user, groupId, refreshUnreadCount, queryClient]);
  
  // Use ref to always get latest profile value in mutation callback
  const profileRef = useRef(profile);
  profileRef.current = profile;
  // Legacy DOM refs are no longer attached (Virtuoso owns scroll). Kept as
  // null refs for any non-scroll code paths that still pass them around.
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const loadTriggerRef = useRef<HTMLDivElement>(null);
  const virtualHandleRef = useRef<VirtualizedChatMessageListHandle>(null);
  const { elementRef: composerRef, height: composerHeight } = useMeasuredElementHeight<HTMLDivElement>(
    [replyTo?.id, editingMessage?.id],
    56,
  );
  
  const chatHeight = useChatViewportHeight();
  const isKeyboardOpen = useKeyboardOpen();
  const nativeKbHeight = useNativeKeyboardHeight();

  const scrollToBottom = useCallback(() => {
    virtualHandleRef.current?.scrollToBottom("auto");
  }, []);

  const targetMessageId = searchParams.get("message");
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
  }, [targetMessageId, targetParentId]);

  // Pinned messages
  const {
    pins: pinnedMessages,
    pinnedMessageIds,
    pin: pinMessage,
    unpin: unpinMessage,
    canPinMore,
  } = usePinnedMessages("group", groupId);
  const handleJumpToMessage = (mid: string) =>
    jumpToMessageInVirtualizedChat(
      mid,
      () => localMessagesRef.current ?? [],
      () => virtualHandleRef.current,
      setHighlightedMessageId,
      { tryLoadOlder: () => loadOlderMessagesRef.current?.() },
    );

  // Fetch group details
  const { data: group, isLoading: groupLoading } = useQuery({
    queryKey: ["chat-group", groupId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_groups")
        .select("*")
        .eq("id", groupId)
        .single();
      if (error) throw error;
      return data as ChatGroup;
    },
    enabled: !!groupId,
    staleTime: 5 * 60 * 1000,
  });

  // Sync active club to this group's owning club so push-launched threads
  // don't leave the user inside the wrong club context.
  useSyncActiveClubToChat(group?.club_id);

  // Check if user is admin (team/club admin or app admin) - run all checks in parallel
  const { data: isAdmin } = useQuery({
    queryKey: ["group-chat-admin", groupId, user?.id, group?.team_id, group?.club_id],
    queryFn: async () => {
      if (!group) return false;
      
      // Run all role checks in parallel
      const [teamRoleResult, clubRoleResult, appAdminResult] = await Promise.all([
        group.team_id
          ? supabase
              .from("user_roles")
              .select("role")
              .eq("user_id", user!.id)
              .eq("team_id", group.team_id)
              .eq("role", "team_admin")
              .maybeSingle()
          : Promise.resolve({ data: null }),
        group.club_id
          ? supabase
              .from("user_roles")
              .select("role")
              .eq("user_id", user!.id)
              .eq("club_id", group.club_id)
              .eq("role", "club_admin")
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user!.id)
          .eq("role", "app_admin")
          .maybeSingle(),
      ]);
      
      return !!teamRoleResult.data || !!clubRoleResult.data || !!appAdminResult.data;
    },
    enabled: !!groupId && authReady && !!group,
    staleTime: 5 * 60 * 1000,
  });

  const { isOnline } = useOnlineStatus();

  // Force a fresh fetch whenever we land on this group. Push notifications and
  // inbox taps can land here while react-query still has stale data — invalidating
  // guarantees the latest message is fetched on entry.
  useEffect(() => {
    if (!groupId || !authReady || !group) return;
    queryClient.invalidateQueries({ queryKey: ["group-messages", groupId] });
  }, [groupId, authReady, group, queryClient]);

  // Fetch messages with reactions - limit to MESSAGES_PER_PAGE for fast initial load
  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ["group-messages", groupId],
    queryFn: async () => {
      // If offline, return cached messages using the shared online manager
      // so native app resume does not incorrectly fall back to stale cache.
      if (!isOnline) {
        const cached = getCachedMessages("group", groupId!);
        if (cached.length > 0) {
          // Transform cached messages to GroupMessage format
          const groupMessages = cached.map(m => ({
            id: m.id,
            text: m.text,
            image_url: m.image_url,
            created_at: m.created_at,
            author_id: m.author_id,
            group_id: groupId!,
            reply_to_id: m.reply_to_id,
            author: m.profiles ? { display_name: m.profiles.display_name, avatar_url: m.profiles.avatar_url } : null,
            reply_to: m.reply_to,
          })) as GroupMessage[];
          const cachedReactions = cached.flatMap((message) =>
            (message.reactions || []).map((reaction) => ({
              id: reaction.id || `cached-${message.id}-${reaction.user_id}-${reaction.reaction_type}`,
              user_id: reaction.user_id,
              reaction_type: reaction.reaction_type,
              group_message_id: message.id,
            }))
          ) as MessageReaction[];
          return { messages: groupMessages, hasOlderMessages: false, reactions: cachedReactions, fromCache: true };
        }
        throw new Error("No cached messages available offline");
      }

      // Fetch messages WITHOUT profile join to avoid timeout from large avatar_url
      const { data: rawMessages, error } = await supabase
        .from("group_messages")
        .select("id, text, image_url, created_at, author_id, group_id, reply_to_id, deleted_at, is_system_message")
        .eq("group_id", groupId)
        .is("deleted_at", null) // Only fetch non-deleted messages
        .order("created_at", { ascending: false })
        .limit(MESSAGES_PER_PAGE + 1);
      if (error) throw error;
      
      if (!rawMessages?.length) {
        return { messages: [] as GroupMessage[], hasOlderMessages: false, reactions: [] as MessageReaction[] };
      }
      
      const hasMore = rawMessages.length > MESSAGES_PER_PAGE;
      const dataToDisplay = hasMore ? rawMessages.slice(0, MESSAGES_PER_PAGE) : rawMessages;
      
      const messageIds = dataToDisplay.map((m) => m.id);
      const replyToIds = dataToDisplay
        .filter((m) => m.reply_to_id)
        .map((m) => m.reply_to_id as string);
      const authorIds = [...new Set(dataToDisplay.map((m) => m.author_id))];

      // Preserve cached reactions when the reactions query fails transiently
      const cachedQueryData = queryClient.getQueryData(["group-messages", groupId]) as any;
      const cachedReactions: MessageReaction[] = cachedQueryData?.reactions || [];
      const cachedReactionsByMessage = new Map<string, MessageReaction[]>();
      cachedReactions.forEach((cr) => {
        const key = cr.group_message_id;
        if (!cachedReactionsByMessage.has(key)) cachedReactionsByMessage.set(key, []);
        cachedReactionsByMessage.get(key)!.push(cr);
      });

      const [reactionsResult, replyToResult, profilesMap] = await Promise.all([
        supabase
          .from("message_reactions")
          .select("id, user_id, reaction_type, group_message_id")
          .in("group_message_id", messageIds),
        replyToIds.length > 0
          ? supabase
              .from("group_messages")
              .select("id, text, author_id")
              .in("id", replyToIds)
          : Promise.resolve({ data: [] as any[] }),
        fetchProfilesWithCache(authorIds),
      ]);

      if (reactionsResult.error) {
        console.warn("[GroupChat] Failed to fetch reactions, keeping cached reactions", reactionsResult.error);
      }

      const replyToMap = new Map(
        (replyToResult.data || []).map((r: any) => [r.id, {
          ...r,
          author: profilesMap.get(r.author_id) ? { display_name: profilesMap.get(r.author_id)?.display_name } : null,
        }])
      );

      // Map to expected format - use fetched profiles
      const messages = dataToDisplay.map((msg: any) => {
        const replyTo = msg.reply_to_id ? replyToMap.get(msg.reply_to_id) || null : null;
        const profile = profilesMap.get(msg.author_id);
        return {
          ...msg,
          author: profile ? { display_name: profile.display_name, avatar_url: profile.avatar_url } : null,
          reply_to: replyTo,
        };
      }) as GroupMessage[];

      // Cache messages for offline access
      cacheMessages("group", groupId!, messages.map(m => ({
        id: m.id,
        text: m.text,
        author_id: m.author_id,
        created_at: m.created_at,
        image_url: m.image_url,
        reply_to_id: m.reply_to_id,
        profiles: m.author ? { display_name: m.author.display_name, avatar_url: m.author.avatar_url } : null,
        reactions: (reactionsResult.data || []).filter((r: any) => r.group_message_id === m.id),
        reply_to: m.reply_to,
      })));
      
      return {
        messages,
        hasOlderMessages: hasMore,
        reactions: reactionsResult.error
          ? cachedReactions
          : (reactionsResult.data || []) as MessageReaction[],
      };
    },
    enabled: !!groupId && authReady,
    staleTime: 1000 * 60 * 5, // 5 minutes - show cache instantly
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    placeholderData: (prev: any) => {
      if (!groupId) return prev;
      // From-push freshness: prefer the just-preloaded localStorage cache
      // over a stale `prev` so the new message renders at first paint.
      if (openedFromNotificationRef.current) {
        const cachedData = getCachedGroupMessages(groupId);
        if (cachedData.messages.length) {
          return { ...cachedData, hasOlderMessages: false, fromCache: true };
        }
      }
      if (prev) return prev;

      const cachedData = getCachedGroupMessages(groupId);
      if (!cachedData.messages.length) return undefined;

      return { ...cachedData, hasOlderMessages: false, fromCache: true };
    },
  });

  // Extract messages and reactions from query data
  const messages = useMemo(() => {
    if (!messagesData) return [];
    const msgList = Array.isArray(messagesData) 
      ? messagesData 
      : (messagesData as any).messages || [];
    // Sort by created_at to ensure proper ordering
    return [...msgList].sort((a, b) => 
      (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) || a.id.localeCompare(b.id)
    );
  }, [messagesData]);

  // Local copy used for rendering so optimistic updates are instant
  const getInitialLocalMessages = () => {
    if (!groupId) return undefined;

    const cachedQueryData = queryClient.getQueryData<{ messages: GroupMessage[]; reactions: MessageReaction[] }>([
      "group-messages",
      groupId,
    ]);

    if (cachedQueryData?.messages?.length) {
      return cachedQueryData.messages;
    }

    return getCachedGroupMessages(groupId).messages;
  };

  const [localMessages, setLocalMessages] = useState<GroupMessage[] | undefined>(() =>
    getInitialLocalMessages(),
  );
  const [infiniteScrollEnabled, setInfiniteScrollEnabled] = useState(false);
  const showLoading =
    (!authReady && !(localMessages?.length)) ||
    (messagesLoading && !messagesData && !(localMessages?.length));

  // Log notification-tap → first-message-render latency once per mount.
  useEffect(() => {
    if (perfLoggedRef.current) return;
    if (!groupId || !user?.id) return;
    if (showLoading) return;
    if (!localMessages || localMessages.length === 0) return;
    perfLoggedRef.current = true;
    const tapTs = openedFromNotificationRef.current;
    void logChatOpenLatency({
      kind: "group",
      targetId: groupId,
      source: tapTs ? "notification" : "cold_open",
      startTs: tapTs ?? mountTsRef.current,
      messageCount: localMessages.length,
      fromCache: !messagesData,
      userId: user.id,
    });
  }, [groupId, user?.id, showLoading, localMessages, messagesData]);
  
  // Extract top-level reactions from query data (must be before useLayoutEffect that uses it)
  const reactions = useMemo(() => {
    if (!messagesData || Array.isArray(messagesData)) return [] as MessageReaction[];
    return ((messagesData as any).reactions || []) as MessageReaction[];
  }, [messagesData]);
  
  // Use fresh profile data that refreshes on visibility change (fixes names vanishing after phone lock)
  const authorIds = useMemo(() => {
    return [...new Set((localMessages || []).map(m => m.author_id).filter(Boolean))];
  }, [localMessages]);
  const { getProfile } = useProfiles(authorIds);
  
  // Reset scroll state when groupId changes
  useEffect(() => {
    setLocalMessages(getInitialLocalMessages());
    setHasOlderMessages(true);
    setInfiniteScrollEnabled(false);
  }, [groupId, queryClient]);

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
    await queryClient.invalidateQueries({ queryKey: ["group-messages", groupId] });
  }, [queryClient, groupId]);

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
    // IMPORTANT: In GroupChatPage, reactions come as a separate top-level array in messagesData,
    // NOT embedded on each message. We must merge the top-level reactions onto each message here.
    // Guard: never replace existing messages with an empty array (transient cache state during resume)
    if (!messages || !groupId || (messages.length === 0 && localMessages && localMessages.length > 0)) return;

    // Build a map of incoming reactions from the top-level reactions array
    const incomingReactionsByMsg = new Map<string, MessageReaction[]>();
    reactions.forEach((r: MessageReaction) => {
      if (!r.group_message_id) return;
      if (!incomingReactionsByMsg.has(r.group_message_id)) incomingReactionsByMsg.set(r.group_message_id, []);
      incomingReactionsByMsg.get(r.group_message_id)!.push(r);
    });

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
      const mergedIncomingMessages = messages.map((message) => {
        const incomingReactions = incomingReactionsByMsg.get(message.id) || [];
        const previousMessage = prev?.find((item) => item.id === message.id);
        const previousReactions: MessageReaction[] = (previousMessage as any)?.reactions || [];

        if (previousReactions.length === 0) {
          return { ...message, reactions: incomingReactions };
        }

        const incomingIds = new Set(incomingReactions.map((r) => r.id));
        const incomingByUser = new Map<string, MessageReaction>();
        incomingReactions.forEach((r) => incomingByUser.set(r.user_id, r));

        // Only preserve temporary optimistic reactions that have not been
        // reconciled yet. Keeping confirmed reactions here can revive deleted
        // group reactions until the next full refresh.
        const missingFromIncoming = previousReactions.filter((reaction) => {
          if (incomingIds.has(reaction.id)) return false;
          if (!reaction.id.startsWith("temp-")) return false;
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

      cacheMessages("group", groupId, mergedMessages.map((m) => ({
        id: m.id,
        text: m.text,
        author_id: m.author_id,
        created_at: m.created_at,
        image_url: m.image_url,
        reply_to_id: m.reply_to_id,
        profiles: m.author ? { display_name: m.author.display_name, avatar_url: m.author.avatar_url } : null,
        reactions: ((m as any).reactions || []).map((reaction: any) => ({
          id: reaction.id,
          user_id: reaction.user_id,
          reaction_type: reaction.reaction_type,
        })),
        reply_to: m.reply_to,
      })));

      return mergedMessages;
    });
  }, [messages, reactions, groupId]);

  // If messages unexpectedly dropped to 0 but we had cached messages, trigger a refetch
  useEffect(() => {
    if (!groupId || !authReady || messagesLoading) return;
    
    const fetchedCount = messages?.length ?? 0;
    if (shouldRefetchMessages("group", groupId, fetchedCount)) {
      console.log("[GroupChat] Messages unexpectedly 0, triggering refetch");
      queryClient.invalidateQueries({ queryKey: ["group-messages", groupId] });
    }
  }, [groupId, authReady, messages, messagesLoading, queryClient]);

  // Visibility change handler - refetch messages and profiles when app becomes visible (e.g., phone unlock)
  useEffect(() => {
    let lastRefresh = Date.now();
    
    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible" && groupId && authReady) {
        const timeSinceLastRefresh = Date.now() - lastRefresh;
        // Only refresh if it's been more than 30 seconds
        if (timeSinceLastRefresh > 30000) {
          console.log("[GroupChat] App became visible, refreshing messages");
          lastRefresh = Date.now();
          await queryClient.invalidateQueries({ queryKey: ["group-messages", groupId] });
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [groupId, authReady, queryClient]);

  // Always ensure profiles are loaded for messages with missing author data
  useEffect(() => {
    if (!localMessages?.length) return;
    
    // Find messages with missing profile data
    const messagesWithMissingProfiles = localMessages.filter(m => !m.author?.display_name);
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
          if (profile && (!msg.author?.display_name || msg.author.display_name === "Unknown")) {
            updated = true;
            return {
              ...msg,
              author: { display_name: profile.display_name, avatar_url: profile.avatar_url },
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
      if ((messagesData as any).fromCache) return;
      setHasOlderMessages((messagesData as any).hasOlderMessages ?? false);
    }
  }, [messagesData]);

  // Keep a ref to the latest localMessages so loadOlderMessages doesn't get
  // recreated on every message change (which would churn the IntersectionObserver
  // and cause overlapping fetches that race past the abort timeout).
  const localMessagesRef = useRef<GroupMessage[] | undefined>(localMessages);
  useEffect(() => {
    localMessagesRef.current = localMessages;
  }, [localMessages]);

  // Forward ref so the loader can be referenced before it's defined.
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

    // Create abort controller for timeout. 25s gives slow networks/cold queries
    // enough headroom; the previous 10s was tripping AbortError on real users.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);
    
    try {
      const oldestMessage = currentMessages.reduce((oldest, message) =>
        new Date(message.created_at).getTime() < new Date(oldest.created_at).getTime() ? message : oldest,
      currentMessages[0]);
      
      const { data: olderData, error } = await supabase
        .from("group_messages")
        .select("id, text, image_url, created_at, author_id, group_id, reply_to_id, is_system_message")
        .eq("group_id", groupId!)
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

      // PASS 1: Render messages IMMEDIATELY with no enrichment.
      const initialOlderMessages = reversedOlder.map((msg) => ({
        ...msg,
        author: null,
        reply_to: null,
      })) as GroupMessage[];

      // Prepend + restore scroll anchor synchronously inside flushSync (no jolt).
      queueAnchoredPrepend(() => {
        queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[], hasOlderMessages?: boolean }>(["group-messages", groupId], (old: any) => {
          if (!old) return { messages: initialOlderMessages, reactions: [], hasOlderMessages: hasMore };
          const existingIds = new Set((old.messages || []).map((m: GroupMessage) => m.id));
          return {
            ...old,
            messages: [
              ...initialOlderMessages.filter((m) => !existingIds.has(m.id)),
              ...old.messages,
            ],
            hasOlderMessages: hasMore,
          };
        });
      });

      // PASS 2: Fire-and-forget enrichment. Allow loader to release immediately
      // so the next page can start prefetching while enrichment is in flight.
      setIsLoadingOlder(false);

      (async () => {
        try {
          const secondaryController = new AbortController();
          const secondaryTimeout = setTimeout(() => secondaryController.abort(), 5000);

          const [reactionsResult, replyToResult, cachedProfiles] = await Promise.all([
            supabase
              .from("message_reactions")
              .select("id, user_id, reaction_type, group_message_id")
              .in("group_message_id", messageIds)
              .abortSignal(secondaryController.signal),
            replyToIds.length > 0
              ? supabase
                  .from("group_messages")
                  .select("id, text, author_id")
                  .in("id", replyToIds)
                  .abortSignal(secondaryController.signal)
              : Promise.resolve({ data: [] as any[], error: null }),
            fetchProfilesWithCache(authorIds),
          ]);

          clearTimeout(secondaryTimeout);
          const reactionsData = reactionsResult.data || [];
          const replyToData = replyToResult.data || [];
          const profilesMap = new Map<string, { display_name: string | null; avatar_url: string | null }>();
          cachedProfiles.forEach((p, id) => {
            profilesMap.set(id, { display_name: p.display_name, avatar_url: p.avatar_url });
          });

          // Patch the cached messages with author + reply_to, append reactions.
          queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[], hasOlderMessages?: boolean }>(["group-messages", groupId], (old: any) => {
            if (!old) return old;
            const idSet = new Set(messageIds);
            return {
              ...old,
              messages: old.messages.map((m: GroupMessage) =>
                idSet.has(m.id)
                  ? {
                      ...m,
                      author: profilesMap.get(m.author_id) || m.author || null,
                      reply_to: replyToData.find((r) => r.id === m.reply_to_id) || m.reply_to || null,
                    }
                  : m
              ),
              reactions: [...(reactionsData as MessageReaction[]), ...old.reactions],
            };
          });
        } catch {
          // Enrichment failed — messages already visible, ignore.
        }
      })();
      return;
    } catch (err) {
      clearTimeout(timeoutId);
      console.error('Failed to load older messages:', err);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [groupId, queryClient, isLoadingOlder, hasOlderMessages, queueAnchoredPrepend]);

  // Keep the loader ref in sync for the anchor hook to call.
  useEffect(() => {
    loadOlderMessagesRef.current = loadOlderMessages;
  }, [loadOlderMessages]);

  // Real-time subscription - directly update cache instead of invalidating
  useEffect(() => {
    if (!groupId) return;

    const channel = supabase
      .channel(`group-messages-${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "group_messages",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          const newMsg = payload.new as any;
          
          // Get cached profile synchronously (instant, non-blocking)
          const { cached: cachedProfiles } = getProfilesFromCache([newMsg.author_id]);
          const cachedProfile = cachedProfiles.get(newMsg.author_id);
          
          // IMMEDIATELY update cache with message (don't wait for profile fetch)
          queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId], (old) => {
            if (!old) return { messages: [{
              ...newMsg,
              author: cachedProfile 
                ? { display_name: cachedProfile.display_name, avatar_url: cachedProfile.avatar_url }
                : null,
              reply_to: null,
            }], reactions: [] };
            
            // Check if message already exists with real ID
            if (old.messages.some(m => m.id === newMsg.id)) {
              return old;
            }
            
            // Check for temp message to replace
            const tempIndex = old.messages.findIndex(
              m => m.id.startsWith('temp-') && m.author_id === newMsg.author_id
            );
            
            const messageToAdd: GroupMessage = {
              ...newMsg,
              author: cachedProfile 
                ? { display_name: cachedProfile.display_name, avatar_url: cachedProfile.avatar_url }
                : null,
              reply_to: null,
            };
            
            if (tempIndex !== -1) {
              // Replace temp message with real one, preserving author from temp message
              const updatedMessages = [...old.messages];
              updatedMessages[tempIndex] = {
                ...messageToAdd,
                author: messageToAdd.author?.display_name 
                  ? messageToAdd.author 
                  : old.messages[tempIndex].author,
                reply_to: old.messages[tempIndex].reply_to,
              };
              return { ...old, messages: updatedMessages };
            }
            
            // Add new message (from other user)
            const updatedMessages = [...old.messages, messageToAdd].sort(
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
                    .from("group_messages")
                    .select("text, author:profiles!group_messages_author_id_fkey(display_name)")
                    .eq("id", newMsg.reply_to_id)
                    .single()
                : Promise.resolve({ data: null }),
            ]).then(([profileData, replyToResult]) => {
              // Update the message with fetched data
              queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId], (old) => {
                if (!old) return old;
                return {
                  ...old,
                  messages: old.messages.map(m => {
                    if (m.id !== newMsg.id) return m;
                    return {
                      ...m,
                      author: profileData 
                        ? { display_name: profileData.display_name, avatar_url: profileData.avatar_url }
                        : m.author,
                      reply_to: replyToResult?.data
                        ? { text: replyToResult.data.text, author: replyToResult.data.author }
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
          table: "group_messages",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          const deletedId = (payload.old as any).id;
          queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId], (old) => {
            if (!old) return { messages: [], reactions: [] };
            return { ...old, messages: old.messages.filter(m => m.id !== deletedId) };
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "group_messages",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          const updated = payload.new as any;
          queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId], (old) => {
            if (!old) return { messages: [], reactions: [] };
            // If message was soft-deleted, remove it from the list
            if (updated.deleted_at) {
              return { ...old, messages: old.messages.filter(m => m.id !== updated.id) };
            }
            // Otherwise update the message content
            return { ...old, messages: old.messages.map(m => m.id === updated.id ? { ...m, text: updated.text, image_url: updated.image_url } : m) };
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
          if (!reaction.group_message_id) return;
          queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId], (old) => {
            if (!old) return { messages: [], reactions: [] };
            // Check if there's already a temp reaction from this user on this message - replace it
            const existingTempIdx = old.reactions.findIndex(
              r => r.id.startsWith('temp-') && r.user_id === reaction.user_id && r.group_message_id === reaction.group_message_id
            );
            // Check if reaction already exists with this ID
            if (old.reactions.some(r => r.id === reaction.id)) return old;
            
            if (existingTempIdx !== -1) {
              const newReactions = [...old.reactions];
              newReactions[existingTempIdx] = reaction;
              return { ...old, reactions: newReactions };
            }
            return { ...old, reactions: [...old.reactions, reaction] };
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
          if (!reaction.group_message_id) return;
          queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId], (old) => {
            if (!old) return { messages: [], reactions: [] };
            const hasExisting = old.reactions.some(r => r.id === reaction.id);
            if (hasExisting) {
              return { ...old, reactions: old.reactions.map(r => r.id === reaction.id ? { ...r, reaction_type: reaction.reaction_type } : r) };
            }
            return { ...old, reactions: [...old.reactions.filter(r => r.user_id !== reaction.user_id || r.group_message_id !== reaction.group_message_id), reaction] };
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
          queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId], (old) => {
            if (!old) return { messages: [], reactions: [] };
            return { ...old, reactions: old.reactions.filter(r => r.id !== deletedReaction.id) };
          });
        }
      )
      .subscribe();
    noteChannelSubscribed(`group-messages-${groupId}`);

    return () => {
      supabase.removeChannel(channel); noteChannelRemoved(`group-messages-${groupId}`);
    };
  }, [groupId, queryClient]);


  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ text, image_url, reply_to_id }: { text: string; image_url: string | null; reply_to_id: string | null }) => {
      if (!user || !groupId) return;
      
      // If offline, queue the message
      if (!navigator.onLine) {
        queueMessage({
          type: "group",
          targetId: groupId,
          authorId: user.id,
          text,
          imageUrl: image_url,
          replyToId: reply_to_id,
          createdAt: new Date().toISOString(),
        });
        return;
      }
      
      const { error } = await supabase.from("group_messages").insert({
        group_id: groupId,
        author_id: user.id,
        text,
        image_url,
        reply_to_id,
      });
      if (error) throw error;
    },
    onMutate: async ({ text, image_url, reply_to_id }) => {
      const currentProfile = profileRef.current;
      await queryClient.cancelQueries({ queryKey: ["group-messages", groupId] });

      const previousData = queryClient.getQueryData(["group-messages", groupId]);

      const optimisticMessage: GroupMessage = {
        id: `temp-${Date.now()}`,
        group_id: groupId!,
        author_id: user!.id,
        text,
        image_url,
        reply_to_id,
        created_at: new Date().toISOString(),
        author: {
          display_name: currentProfile?.display_name || "You",
          avatar_url: currentProfile?.avatar_url || null,
        },
        reply_to: replyTo ? { text: replyTo.text, author: { display_name: replyTo.author?.display_name || null } } : null,
      };

      // Update query cache directly (this will sync to localMessages via useEffect)
      queryClient.setQueryData(["group-messages", groupId], (old: any) => {
        const existingMessages: GroupMessage[] = old?.messages || [];
        return {
          ...(old || {}),
          messages: [...existingMessages, optimisticMessage],
          reactions: old?.reactions || [],
        };
      });

      // Clear input immediately
      setMessage("");
      setImageUrl(null);
      setReplyTo(null);
      setPendingPollId(null);
      
      // Scroll to bottom to show new message
      scrollToBottom();

      return { previousData };
    },
    onError: (err, variables, context) => {
      // Don't revert if offline - message is queued
      if (!navigator.onLine) {
        toast.info("Message queued - will send when online");
        return;
      }
      if (context?.previousData) {
        queryClient.setQueryData(["group-messages", groupId], context.previousData);
      }
      toast.error("Failed to send message");
    },
    onSettled: (_, __, variables) => {
      // Invalidate messages page preview so latest message shows
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups-with-messages"] });
      // Award engagement points (fire and forget)
      if (user && groupId && group?.club_id) {
        import("@/lib/engagementPoints").then(({ awardEngagementPoints }) => {
          awardEngagementPoints({
            userId: user.id,
            clubId: group.club_id!,
            action: "chat_message",
            scopeId: groupId,
          }).catch(() => {});
        });
        // Auto-sync attachments/file links to vault (fire and forget)
        if (variables?.image_url || variables?.text) {
          import("@/lib/chatVaultSync").then(({ syncChatAttachmentToVault }) => {
            syncChatAttachmentToVault({
              imageUrl: variables.image_url,
              text: variables.text,
              userId: user.id,
              clubId: group.club_id!,
              teamId: group.team_id,
              chatGroupId: group.id,
              chatGroupName: group.name,
              chatGroupAllowedRoles: group.allowed_roles as any,
            }).catch(() => {});
          });
        }
      }
    },
   });

  // Update message mutation
  const updateMessageMutation = useMutation({
    mutationFn: async () => {
      if (!editingMessage) return;
      const { error } = await supabase
        .from("group_messages")
        .update({ text: message.trim() })
        .eq("id", editingMessage.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setMessage("");
      setEditingMessage(null);
      queryClient.invalidateQueries({ queryKey: ["group-messages", groupId] });
      // silent success
    },
    onError: () => {
      toast.error("Failed to update message");
    },
  });

  // Delete message mutation (hard delete)
  const deleteMessageMutation = useMutation({
    mutationFn: async (messageId: string) => {
      const { error } = await supabase
        .from("group_messages")
        .delete()
        .eq("id", messageId);
      if (error) throw error;
    },
    onMutate: async (messageId: string) => {
      // Optimistically hide the message
      await queryClient.cancelQueries({ queryKey: ["group-messages", groupId] });
      const previousData = queryClient.getQueryData(["group-messages", groupId]);
      
      queryClient.setQueryData(["group-messages", groupId], (old: any) => {
        if (!old) return old;
        const existingMessages: GroupMessage[] = old?.messages || [];
        return { ...old, messages: existingMessages.filter(m => m.id !== messageId) };
      });
      
      return { previousData, messageId };
    },
    onSuccess: (_, messageId) => {
      // Remove from localStorage cache to prevent reappearing
      removeMessageFromCache("group", groupId!, messageId);
      // Clear the messagesPage cache
      try {
        localStorage.removeItem('messages-page-cache');
      } catch {}
      // Invalidate the messages page query so latest message preview updates
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups-with-messages"] });
      // Silent success - no toast
    },
    onError: (err, variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(["group-messages", groupId], context.previousData);
      }
      toast.error("Failed to delete message");
    },
  });

  // Toggle reaction mutation with optimistic updates
  // Rule: One reaction per user per message. Clicking same emoji removes it, different emoji replaces it.
  const lastReactionIntentRef = useRef<Record<string, { reactionType: string; action: "add" | "remove" | "update" }>>({});

  const toggleReactionMutation = useMutation({
    retry: 1,
    mutationFn: async ({ messageId, reactionType }: { messageId: string; reactionType: string }) => {
      if (!user) return { action: 'none' as const };

      // Ensure the auth token is fresh — a stale/expired JWT causes RLS to
      // reject the insert/update with "Failed to update reaction".
      try {
        await ensureFreshSession();
      } catch (e) {
        console.error('[Reaction] Session not ready:', e);
        throw new Error('Not authenticated');
      }

      const normalizedReactionType = normalizeGroupReactionType(reactionType);

      console.log('[Reaction] Starting mutation for message:', messageId, 'type:', normalizedReactionType);

      const optimisticIntent = lastReactionIntentRef.current[messageId];

      const { data: existingReaction, error: fetchError } = await supabase
        .from("message_reactions")
        .select("id, reaction_type")
        .eq("group_message_id", messageId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (fetchError) {
        console.error('[Reaction] Fetch existing error:', fetchError);
        throw fetchError;
      }

      console.log('[Reaction] Existing reaction from DB:', existingReaction, 'optimisticIntent:', optimisticIntent);

      if (existingReaction) {
        const normalizedExistingReactionType = normalizeGroupReactionType(existingReaction.reaction_type);

        if (normalizedExistingReactionType === normalizedReactionType) {
          console.log('[Reaction] Removing existing reaction');
          const { error } = await supabase.from("message_reactions").delete().eq("id", existingReaction.id);
          if (error) {
            console.error('[Reaction] Delete error:', error);
            throw error;
          }
          return { action: 'removed' as const, reactionId: existingReaction.id, messageId };
        }

        console.log('[Reaction] Updating existing reaction to:', normalizedReactionType);
        const { data, error } = await supabase.from("message_reactions")
          .update({ reaction_type: normalizedReactionType })
          .eq("id", existingReaction.id)
          .select()
          .maybeSingle();
        if (error) {
          console.error('[Reaction] Update error:', error);
          throw error;
        }
        console.log('[Reaction] Update success:', data);
        return { action: 'updated' as const, reaction: data, oldReactionId: existingReaction.id, messageId };
      }

      if (optimisticIntent?.reactionType === normalizedReactionType && optimisticIntent.action === 'remove') {
        console.log('[Reaction] Skipping re-add because latest optimistic intent is remove');
        return { action: 'removed' as const, reactionId: null, messageId };
      }

      console.log('[Reaction] Adding new reaction');
      const { data, error } = await supabase.from("message_reactions").insert({
        group_message_id: messageId,
        user_id: user.id,
        reaction_type: normalizedReactionType,
      }).select().maybeSingle();

      if (error) {
        if (error.code === '23505') {
          console.warn('[Reaction] Duplicate reaction, reconciling existing row');
          const { data: conflictingReaction, error: conflictFetchError } = await supabase
            .from("message_reactions")
            .select("*")
            .eq("group_message_id", messageId)
            .eq("user_id", user.id)
            .maybeSingle();

          if (conflictFetchError) throw conflictFetchError;

          if (normalizeGroupReactionType(conflictingReaction?.reaction_type) === normalizedReactionType) {
            if (optimisticIntent?.reactionType === normalizedReactionType && optimisticIntent.action === 'remove') {
              const { error: deleteError } = await supabase
                .from("message_reactions")
                .delete()
                .eq("id", conflictingReaction.id);
              if (deleteError) throw deleteError;
              return { action: 'removed' as const, reactionId: conflictingReaction.id, messageId };
            }

            return { action: 'updated' as const, reaction: conflictingReaction, oldReactionId: conflictingReaction.id, messageId };
          }

          const { data: updatedReaction, error: updateError } = await supabase
            .from("message_reactions")
            .update({ reaction_type: normalizedReactionType })
            .eq("id", conflictingReaction?.id)
            .select()
            .maybeSingle();

          if (updateError) throw updateError;
          return { action: 'updated' as const, reaction: updatedReaction, oldReactionId: conflictingReaction?.id, messageId };
        }

        console.error('[Reaction] Insert error:', error);
        throw error;
      }

      console.log('[Reaction] Insert success:', data);
      return { action: 'added' as const, reaction: data ?? { id: `server-${Date.now()}`, user_id: user.id, reaction_type: normalizedReactionType, group_message_id: messageId }, messageId };
    },
    onMutate: async ({ messageId, reactionType }) => {
      await queryClient.cancelQueries({ queryKey: ["group-messages", groupId] });

      const previousData = queryClient.getQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId]);

      const existingReaction = previousData?.reactions.find(
        r => r.group_message_id === messageId && r.user_id === user?.id
      );
      const normalizedReactionType = normalizeGroupReactionType(reactionType);
      const normalizedExistingReactionType = normalizeGroupReactionType(existingReaction?.reaction_type);

      lastReactionIntentRef.current[messageId] = {
        reactionType: normalizedReactionType,
        action: !existingReaction ? 'add' : normalizedExistingReactionType === normalizedReactionType ? 'remove' : 'update',
      };

      queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId], (old) => {
        if (!old) return { messages: [], reactions: [] };

        if (existingReaction) {
          if (normalizedExistingReactionType === normalizedReactionType) {
            return { ...old, reactions: old.reactions.filter(r => r.id !== existingReaction.id) };
          }

          return {
            ...old,
            reactions: old.reactions.map(r =>
              r.id === existingReaction.id
                ? { ...r, reaction_type: normalizedReactionType }
                : r
            )
          };
        }

        const tempReaction: MessageReaction = {
          id: `temp-reaction-${Date.now()}`,
          user_id: user!.id,
          reaction_type: normalizedReactionType,
          group_message_id: messageId,
        };
        return { ...old, reactions: [...old.reactions, tempReaction] };
      });

      return { previousData, existingReaction, messageId };
    },
    onError: (err, variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(["group-messages", groupId], context.previousData);
      }
      if (context?.messageId) {
        delete lastReactionIntentRef.current[context.messageId];
      }
      toast.error("Failed to update reaction");
    },
    onSuccess: (result) => {
      if (!result) return;

      queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId], (old) => {
        if (!old) return { messages: [], reactions: [] };

        if (result.action === 'added' && result.reaction) {
          const filteredReactions = old.reactions.filter(r =>
            !(r.id.startsWith('temp-reaction-') &&
              r.group_message_id === result.reaction.group_message_id &&
              r.user_id === result.reaction.user_id)
          );
          if (!filteredReactions.some(r => r.id === result.reaction.id)) {
            return { ...old, reactions: [...filteredReactions, result.reaction] };
          }
          return { ...old, reactions: filteredReactions };
        }

        if (result.action === 'updated' && result.reaction) {
          return {
            ...old,
            reactions: old.reactions.map(r =>
              r.id === result.reaction.id || (r.id.startsWith('temp-reaction-') && r.group_message_id === result.reaction.group_message_id && r.user_id === result.reaction.user_id)
                ? result.reaction
                : r
            )
          };
        }

        if (result.action === 'removed') {
          return {
            ...old,
            reactions: old.reactions.filter(r => !(r.group_message_id === result.messageId && r.user_id === user?.id))
          };
        }

        return old;
      });

      if ('messageId' in result && result.messageId) {
        delete lastReactionIntentRef.current[result.messageId];
      }
    },
  });

  const handleSend = () => {
    if ((!message.trim() && !imageUrl && !pendingPollId) || !user) return;
    if (editingMessage) {
      updateMessageMutation.mutate();
    } else {
      const baseText = message.trim();
      const finalText = pendingPollId
        ? (baseText ? `${baseText} [poll:${pendingPollId}]` : `[poll:${pendingPollId}]`)
        : baseText;
      sendMessageMutation.mutate({
        text: finalText,
        image_url: imageUrl,
        reply_to_id: replyTo?.id || null,
      });
    }
  };

  const handleEdit = (msg: GroupMessage) => {
    setEditingMessage(msg);
    setMessage(msg.text);
    inputRef.current?.focus();
  };

  const handleCancelEdit = () => {
    setEditingMessage(null);
    setMessage("");
  };

  const handleReply = (msg: GroupMessage) => {
    if (msg.id.startsWith("temp-") || msg.id.startsWith("queued-")) {
      toast.warning("Please wait for the message to send before replying.");
      return;
    }
    setReplyTo(msg);
    setTimeout(() => virtualHandleRef.current?.scrollToBottom("auto"), 100);
    inputRef.current?.focus();
  };

  const handleSearchResult = (messageId: string) => {
    jumpToMessageInVirtualizedChat(
      messageId,
      () => localMessagesRef.current ?? [],
      () => virtualHandleRef.current,
      setHighlightedMessageId,
      { tryLoadOlder: () => loadOlderMessagesRef.current?.() },
    );
  };

  const { isSearching: isSearchFetching, canShowEmpty: searchCanShowEmpty } = useChatHistorySearch<GroupMessage>({
    searchQuery,
    loadedMessages: localMessages,
    setMessages: (updater) => setLocalMessages((prev) => updater(prev)),
    enabled: !!groupId,
    cacheKey: `group:${groupId ?? ""}`,
    fetcher: async (q, signal) =>
      (await searchChatHistory({
        table: "group_messages",
        scope: { group_id: groupId! },
        query: q,
        signal,
        selectColumns: "id, text, image_url, created_at, author_id, group_id, reply_to_id, is_system_message",
      })) as GroupMessage[],
  });

  const filteredMessages = useMemo(() => {
    if (!localMessages) return localMessages;
    const base = !searchQuery.trim()
      ? localMessages
      : localMessages.filter((m) =>
          fuzzyMatchesQuery(m.text, searchQuery)
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

  const messagesById = useMemo(
    () => new Map((localMessages || []).map((message) => [message.id, message])),
    [localMessages]
  );

  // Message IDs for read tracking
  const messageIds = useMemo(() => 
    (filteredMessages || []).map(m => m.id).filter(id => !id.startsWith('temp-')),
    [filteredMessages]
  );

  // Read tracking
  const { readCounts, readFrontier, markMessagesAsRead } = useMessageReads(
    "group",
    groupId || "",
    messageIds,
    user?.id
  );

  // Typing indicator
  const { typingUsers, startTyping, stopTyping } = useTypingIndicator(
    `group-${groupId}`,
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

  const messageReactionsMap = useMemo(() => {
    const map = new Map<string, MessageReaction[]>();
    const reactionsByMessage = new Map<string, MessageReaction[]>();
    const hasResolvedReactionData = !!messagesData && !Array.isArray(messagesData);

    reactions.forEach((reaction) => {
      if (!reaction.group_message_id) return;
      if (!reactionsByMessage.has(reaction.group_message_id)) {
        reactionsByMessage.set(reaction.group_message_id, []);
      }
      reactionsByMessage.get(reaction.group_message_id)!.push(reaction);
    });

    for (const msg of (localMessages || [])) {
      const embedded: MessageReaction[] = (msg as any).reactions || [];
      map.set(msg.id, hasResolvedReactionData ? (reactionsByMessage.get(msg.id) ?? []) : embedded);
    }

    return map;
  }, [localMessages, messagesData, reactions]);

  // Delete group mutation
  const deleteGroupMutation = useMutation({
    mutationFn: async () => {
      // Soft-delete: keep the row so app admins can restore within the retention window.
      const { error } = await supabase
        .from("chat_groups")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: user?.id ?? null,
        } as any)
        .eq("id", groupId!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Chat removed. An app admin can restore it if needed.");
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups"] });
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups-with-messages"] });
      navigate("/messages");
    },
    onError: () => toast.error("Failed to delete group"),
  });

  // Live online count for the group — shown in the header sublabel.
  const groupOnlineCount = useChatOnlineCount("group", groupId, {
    teamId: group?.team_id ?? null,
    clubId: group?.club_id ?? null,
    groupAllowedRoles: (group?.allowed_roles as any) ?? null,
    enabled: !!group,
  });

  const {
    publishingIds: galleryPublishingIds,
    publishedIds: galleryPublishedIds,
    publish: handlePublishToGallery,
  } = usePublishChatImage({
    uploaderId: user?.id,
    teamId: group?.team_id ?? null,
    clubId: group?.club_id ?? null,
  });

  const groupBaseSublabel = group?.mini_league_id
    ? "Mini-league chat"
    : group?.team_id
    ? "Team group"
    : group?.club_id
    ? "Club group"
    : "Personal group";
  const groupHeaderSublabel = groupOnlineCount > 0
    ? `${groupBaseSublabel} · ${groupOnlineCount} online`
    : groupBaseSublabel;

  if (groupLoading) {
    return <PageLoading message="Loading group chat..." />;
  }

  if (!group) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted-foreground text-center px-4">This chat group has been removed or is no longer available.</p>
        <Button variant="outline" onClick={() => navigate("/messages")}>
          Back to Messages
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col overflow-hidden overscroll-none" style={{ height: chatHeight }} data-lock-keyboard-scroll="true" onTouchStart={swipeBack.onTouchStart} onTouchEnd={swipeBack.onTouchEnd}>
      {/* Header */}
      <ChatHeaderShell
        type={group.team_id || group.club_id ? "group" : "group"}
        name={group.name}
        sublabel={groupHeaderSublabel}
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
              onEditGroup={isAdmin ? () => setShowEditGroupDialog(true) : undefined}
              onDeleteGroup={(isAdmin || group.created_by === user?.id) ? () => setShowDeleteGroupDialog(true) : undefined}
              onManagePinnedVault={
                (isAdmin || group.created_by === user?.id) ? () => setPinVaultSheetOpen(true) : undefined
              }
              pinnedVaultEnabled={pinnedVault.record ? pinnedVault.record.enabled : null}
              onTogglePinnedVault={
                pinnedVault.record && (isAdmin || group.created_by === user?.id)
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
        chatType="group"
        chatId={groupId!}
        name={group.name}
        sublabel={groupBaseSublabel}
        teamId={group.team_id || undefined}
        clubId={group.club_id || undefined}
        miniLeagueId={group.mini_league_id || undefined}
        groupAllowedRoles={group.allowed_roles}
        groupCreatedBy={group.created_by}
        groupMembershipMode={group.membership_mode}
      />



      {/* Notification Nudge */}
      {notificationNudge.shouldShowNudge && (
        <div className="px-4 pt-2 shrink-0">
          <NotificationNudgeBanner
            message="Enable notifications so you never miss group messages"
            onDismiss={notificationNudge.dismiss}
            userId={user?.id}
          />
        </div>
      )}

      {/* Pinned messages banner */}
      <PinnedMessagesBanner
        pins={pinnedMessages}
        onJumpToMessage={handleJumpToMessage}
        onUnpin={unpinMessage}
      />

      {/* Messages */}
      <div className="flex-1 min-h-0 py-4 flex flex-col relative overflow-hidden overscroll-none">
        {showLoading ? (
          <p className="text-center text-muted-foreground">Loading messages...</p>
        ) : (isSearchFetching || (!!searchQuery && !searchCanShowEmpty)) ? (
          <ChatSearchLoadingState />
        ) : filteredMessages?.length === 0 ? (
          <ChatEmptyState
            title="No messages yet"
            subtitle="Start the conversation!"
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
            renderRow={(msg, index, arr) => {
              const isOwnMessage = msg.author_id === user?.id;
              const messageReactions = messageReactionsMap.get(msg.id) || [];
              const currentDate = new Date(msg.created_at);
              const prevMessage = index > 0 ? arr[index - 1] : null;
              const showDateSeparator = !prevMessage || !isSameDay(currentDate, new Date(prevMessage.created_at));
              return (
                <>
                  {showDateSeparator && <ChatDateSeparator date={currentDate} />}
                  <GroupChatMessageRow
                    msg={msg}
                    messagesById={messagesById}
                    isOwnMessage={isOwnMessage}
                    isAdmin={isAdmin}
                    highlightedMessageId={highlightedMessageId}
                    messageReactions={messageReactions}
                    userId={user?.id}
                    getProfile={getProfile}
                    readFrontier={readFrontier}
                    readCounts={readCounts}
                    handleReply={handleReply}
                    handleEdit={handleEdit}
                    deleteMessageMutation={deleteMessageMutation}
                    toggleReactionMutation={toggleReactionMutation}
                    groupId={groupId || ""}
                    searchQuery={searchQuery}
                    isPinned={pinnedMessageIds.has(msg.id)}
                    pinLimitReached={!canPinMore && !pinnedMessageIds.has(msg.id)}
                    onPin={pinMessage}
                    onUnpin={unpinMessage}
                    canPublishToGallery={isOwnMessage && !!msg.image_url && !msg.id.startsWith("queued-") && (!!group?.team_id || !!group?.club_id)}
                    isPublishingToGallery={galleryPublishingIds.has(msg.id)}
                    isPublishedToGallery={galleryPublishedIds.has(msg.id)}
                    onPublishToGallery={handlePublishToGallery}
                  />
                </>
              );
            }}
          />
        )}
      </div>

      {/* Input - Fixed at bottom above nav bar */}
      <div className={`fixed left-0 right-0 bg-background z-[49] pointer-events-none ${searchOpen ? "hidden" : ""}`} style={{ bottom: nativeKbHeight, height: nativeKbHeight > 0 ? "3rem" : "calc(var(--bottom-nav-offset, 0px) + 3rem)" }} />
        <div ref={composerRef} data-chat-chrome="true" className={`fixed left-0 right-0 w-full max-w-full overflow-visible border-t border-border/30 pt-1 pb-2 px-2 bg-background/95 z-[51] ${searchOpen ? "hidden" : ""}`} style={{ bottom: nativeKbHeight > 0 ? nativeKbHeight : "var(--bottom-nav-offset, 0px)" }}>
        <TypingIndicator typingUsers={typingUsers} />
        {replyTo && (
          <ReplyPreview
            replyingTo={{
              id: replyTo.id,
              text: replyTo.text,
              authorName: replyTo.author?.display_name || null,
            }}
            onCancel={() => setReplyTo(null)}
          />
        )}
        {editingMessage && (
          <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground">
            <span>Editing message</span>
            <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
              Cancel
            </Button>
          </div>
        )}
        {pendingPollId && !editingMessage && (
          <PollAttachmentPreview
            pollId={pendingPollId}
            onRemove={() => setPendingPollId(null)}
            disabled={sendMessageMutation.isPending}
          />
        )}
        {scheduleTarget && <ScheduledMessagesBanner target={scheduleTarget} />}
        <div className="flex w-full max-w-full min-w-0 items-center gap-0.5 overflow-visible px-2 py-1">
          <ChatImageInput 
            onImageUploaded={setImageUrl} 
            imageUrl={imageUrl} 
            clubId={group?.club_id || undefined}
            teamId={group?.team_id || undefined}
            showEventPicker={true}
            onEventSelect={() => setEventPickerOpen(true)}
            showPollCreator={true}
            onPollCreate={() => setPollDialogOpen(true)}
            showBoardPicker={true}
            onBoardPick={() => setBoardPickerOpen(true)}
            showVaultPicker={!!group?.club_id}
            onAppendToken={(token) => setMessage(message ? `${message} ${token}` : token)}
            hasText={!!message.trim()}
          />
          <MentionInput
            value={message}
            onChange={(val) => {
              setMessage(val);
              if (val.trim()) startTyping();
              else stopTyping();
            }}
            placeholder="Type a message..."
            onKeyPress={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                stopTyping();
                handleSend();
              }
            }}
            groupId={groupId}
            teamId={group?.team_id || undefined}
            clubId={group?.club_id || undefined}
            disabled={false}
            onGifSelect={setImageUrl}
          />
          <ChatSendButton
            onSend={() => {
              stopTyping();
              handleSend();
            }}
            onSchedule={scheduleTarget ? () => setScheduleDialogOpen(true) : undefined}
            disabled={!message.trim() && !imageUrl && !pendingPollId}
            loading={sendMessageMutation.isPending}
            canSend={!!message.trim() || !!imageUrl || !!pendingPollId}
          />
        </div>
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
          teamId={group?.team_id || undefined}
          clubId={group?.club_id || undefined}
        />
        <BoardPickerSheet
          open={boardPickerOpen}
          onOpenChange={setBoardPickerOpen}
          onSelectBoard={(gameId) => {
            const token = `[board:${gameId}]`;
            setMessage(message ? `${message} ${token}` : token);
          }}
        />
        {groupId && (
          <CreatePollDialog
            open={pollDialogOpen}
            onOpenChange={setPollDialogOpen}
            chatType="group"
            chatId={groupId}
            onCreated={(pollId) => setPendingPollId(pollId)}
          />
        )}
      </div>

      {/* Edit Group Dialog */}
      {isAdmin && group && (
        <EditGroupDialog
          group={{
            id: group.id,
            name: group.name,
            allowed_roles: group.allowed_roles as any,
            membership_mode: group.membership_mode,
          }}
          open={showEditGroupDialog}
          onOpenChange={setShowEditGroupDialog}
        />
      )}

      {/* Delete Group Confirmation — requires typing the group name to enable. */}
      <AlertDialog
        open={showDeleteGroupDialog}
        onOpenChange={(open) => {
          setShowDeleteGroupDialog(open);
          if (!open) setDeleteConfirmText("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{group.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the chat from everyone's inbox. Messages stay archived
              and an app admin can restore the chat within 30 days. To continue, type
              the group name below.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input
            type="text"
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder={group.name}
            autoCapitalize="none"
            autoCorrect="off"
            className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                if (deleteConfirmText.trim() !== group.name.trim()) {
                  e.preventDefault();
                  toast.error("Group name does not match");
                  return;
                }
                deleteGroupMutation.mutate();
              }}
              disabled={
                deleteConfirmText.trim() !== group.name.trim() ||
                deleteGroupMutation.isPending
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteGroupMutation.isPending ? "Deleting..." : "Delete chat"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
