import React, { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect, lazy, Suspense } from "react";
import { useChatLoadingLatch } from "@/hooks/useChatLoadingLatch";
import { consumePendingChatJump, getLastConsumedPendingChatJumpTs, subscribePendingChatJump, type PendingChatJumpPayload } from "@/lib/pendingChatJump";
import { resolveChatJumpTarget } from "@/lib/resolveChatJumpTarget";
import { fuzzyMatchesQuery } from "@/lib/fuzzySearch";
import { useChatDraft, useChatDraftReply } from "@/hooks/useChatDraft";
import { useSyncActiveClubToChat } from "@/hooks/useSyncActiveClubToChat";
import { useChatViewportHeight } from "@/hooks/useChatViewportHeight";
import { ChatMessagesScroller } from "@/components/chat/ChatMessagesScroller";
import { debugLogEvent } from "@/components/chat/chatVirtDebug";
import { shouldGroupWithPrev } from "@/lib/chatGrouping";
import { findLocalReplyMessage } from "@/lib/chatRealtimeReply";
import { useRealtimeReactionSync } from "@/hooks/useRealtimeReactionSync";
import { reconcileFlatReactions, reconcileReactions } from "@/lib/chatReactionReconciliation";
import {
  recordRealtimeMutation,
  reconcileMessages,
  applyMessageUpdate,
  removeMessage,
  isTombstoned,
  clearReconciliationScope,
} from "@/lib/chatMessageReconciliation";
import { createSendTempId, splitPollMarkup, restoreFailedSendComposer, authoritativeMessageExists, findSupersededOptimisticIndex, type FailedSendContext } from "@/lib/failedSendRestore";
import { deliveredSend, queuedSend, isConfirmedDelivery } from "@/lib/chatSendResult";

import type { VirtualizedChatMessageListHandle } from "@/components/chat/VirtualizedChatMessageList";
import { useMeasuredElementHeight } from "@/hooks/useMeasuredElementHeight";
import { keepComposerFocusedThroughSend } from "@/lib/chatComposerFocus";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";
import { useNativeKeyboardBottomInset } from "@/hooks/useNativeKeyboardBottomInset";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { markChatScopeNotificationsRead } from "@/lib/markChatScopeRead";
import { ensureFreshSession, isAuthLikeError } from "@/lib/ensureFreshSession";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { MentionInput } from "@/components/chat/MentionInput";
import { ChatComposerShell } from "@/components/chat/ChatComposerShell";
import { canPostInCompetitionChat, competitionChatSublabel } from "@/features/competitions/competitionChatScope";

import { ArrowLeft, Send, MoreVertical, Pencil, Trash2, Reply, SmilePlus, Loader2, Clock, Users, Search, UserPlus, ChevronRight, Lock } from "lucide-react";
import { ChatBackButton } from "@/components/chat/ChatBackButton";
import { useSwipeBack } from "@/hooks/useSwipeBack";
import { ChatHeaderShell } from "@/components/chat/ChatHeaderShell";
import { ChatDetailsSheet } from "@/components/chat/ChatDetailsSheet";
import { ChatHeaderMenu } from "@/components/chat/ChatHeaderMenu";
import { ChatCatchUp } from "@/components/chat/ChatCatchUp";
import { markChatOpened } from "@/hooks/useChatCatchUp";
import { useAICatchUpAvailability } from "@/hooks/useAICatchUpAvailability";
import { useUnreadMessageCounts } from "@/hooks/useUnreadMessageCounts";
import { useChatOnlineCount } from "@/hooks/useChatOnlineCount";
import { useChatPageReady } from "@/hooks/useChatPageReady";
import { ChatSearchBar, ChatSearchLoadingState } from "@/components/chat/ChatSearch";
import { useChatHistorySearch } from "@/hooks/useChatHistorySearch";
import { searchChatHistory } from "@/lib/searchChatHistory";
import { fetchMessagesAround } from "@/lib/fetchMessagesAround";

import { PageLoading } from "@/components/ui/page-loading";
import { ChatPageSkeleton } from "@/components/chat/ChatPageSkeleton";
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
import { NewsPickerSheet } from "@/components/chat/NewsPickerSheet";
import { BoardPickerSheet } from "@/components/chat/BoardPickerSheet";
import { CreatePollDialog } from "@/components/chat/CreatePollDialog";
import { PollAttachmentPreview } from "@/components/chat/PollAttachmentPreview";
import { NewsAttachmentPreview } from "@/components/chat/NewsAttachmentPreview";
import { GroupChatMessageRow } from "@/components/chat/GroupChatMessageRow";
import { usePublishChatImage } from "@/hooks/usePublishChatImage";
import { useRecentMatchWindow } from "@/hooks/useRecentMatchWindow";
import { PinnedMessagesBanner } from "@/components/chat/PinnedMessagesBanner";
import { PinnedVaultBanner } from "@/components/chat/PinnedVaultBanner";
import { PinVaultSheet } from "@/components/chat/PinVaultSheet";
import { useChatPinnedVault } from "@/hooks/useChatPinnedVault";
import { useClubProAccess } from "@/hooks/useClubProAccess";
import { useUserHasAnyClubPro } from "@/hooks/useUserHasAnyClubPro";
import { useClubRealtimeMode } from "@/hooks/useClubRealtimeMode";
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
import {
  classifyChatThreadState,
  nextEmptyRetryDelay,
  isUsableCachedThread,
} from "@/lib/chatThreadLoadState";

import { consumeFromNotificationFlag } from "@/lib/notificationPreload";
import { logChatOpenLatency } from "@/lib/chatOpenLatency";
import { useChatPerfMarks, markChatFetch } from "@/hooks/useChatPerfMarks";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { queueMessage, getQueuedMessagesForTarget } from "@/lib/messageQueue";
import { Capacitor } from "@capacitor/core";
import { useNotificationNudge } from "@/hooks/useNotificationNudge";
import { NotificationNudgeBanner } from "@/components/NotificationNudgeBanner";
const AddMiniLeagueMemberSheet = lazyWithRetry(() => import("@/components/AddMiniLeagueMemberSheet").then(m => ({ default: m.AddMiniLeagueMemberSheet })));
import { noteChatMount, noteChatUnmount, noteChannelSubscribed, noteChannelRemoved } from "@/lib/chatPerfDiagnostics";
import { registerChannel } from "@/lib/realtimeChannelRegistry";
import { shouldSkipChatMountInvalidate } from "@/lib/chatMountInvalidate";
import { useChatStuckWatchdog } from "@/lib/chatStuckWatchdog";
import { resolveChatMetadataState } from "@/lib/chatMetadataGate";
import { ChatUnreachable } from "@/components/chat/ChatUnreachable";
import { isChatEagerInvalidateEnabled, ensureSessionApplied } from "@/lib/chatEagerInvalidate";
import { lazyWithRetry } from "@/lib/lazyWithRetry";



const REACTION_EMOJIS = ["👍", "❤️", "🔥", "👏", "😂", "😢"];

// Stable empty array reference so rows with no reactions don't bust
// GroupChatMessageRow's memo on every parent render.
const EMPTY_REACTIONS: never[] = [];

const GROUP_REACTION_EMOJI_MAP: Record<string, string> = {
  "❤️": "❤️",
  "🔥": "🔥",
  "👏": "👏",
  "😂": "😂",
  "👍": "👍",
  "😢": "😢",
  "🎉": "🎉",
  "😮": "😮",
  like: "❤️",
  fire: "🔥",
  clap: "👏",
  laugh: "😂",
  thumbsup: "👍",
  sad: "😢",
  celebrate: "🎉",
  wow: "😮",
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
  forwarded_from_user_id?: string | null;
  forwarded_at?: string | null;
  forwarded_source_label?: string | null;
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
  category: string | null;
  join_policy: string | null;
  allow_forwarding?: boolean;
}

interface MessageReaction {
  id: string;
  user_id: string;
  reaction_type: string;
  group_message_id: string | null;
}

const attachReactionsToMessages = (
  messages: GroupMessage[],
  reactions: MessageReaction[],
): GroupMessage[] => {
  if (!messages.length) return messages;
  if (!reactions.length) return messages;
  const byMessage = new Map<string, MessageReaction[]>();
  for (const reaction of reactions) {
    const key = reaction.group_message_id;
    if (!key) continue;
    const list = byMessage.get(key);
    if (list) list.push(reaction);
    else byMessage.set(key, [reaction]);
  }
  return messages.map((message) => {
    const own = byMessage.get(message.id);
    if (!own || own.length === 0) return message;
    return { ...(message as any), reactions: own } as GroupMessage;
  });
};

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

  // Embed reactions on the message rows too, so the very first paint (which is
  // seeded straight from this cache) already shows existing reactions instead
  // of waiting for the post-mount merge effect / refetch.
  return { messages: attachReactionsToMessages(messages, reactions), reactions };
};


export default function GroupChatPage() {
  // [chat-perf-diag] track mount/unmount lifetime
  React.useEffect(() => {
    const k = noteChatMount("GroupChat", null);
    debugLogEvent("page-mount", {});
    return () => {
      debugLogEvent("page-unmount", {});
      noteChatUnmount("GroupChat", k, null);
    };
  }, []);
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, profile, refreshUnreadCount, decrementUnreadCount, initialized } = useAuth();
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
  const [miniLeagueInviteOpen, setMiniLeagueInviteOpen] = useState(false);
  const scheduleTarget: ScheduleTarget | null = groupId
    ? { chat_type: "group", group_id: groupId }
    : null;
  const [replyTo, setReplyTo] = useChatDraftReply<GroupMessage>(groupId);
  const [editingMessage, setEditingMessage] = useState<GroupMessage | null>(null);
  const [eventPickerOpen, setEventPickerOpen] = useState(false);
  const [newsPickerOpen, setNewsPickerOpen] = useState(false);
  const [boardPickerOpen, setBoardPickerOpen] = useState(false);
  const [pollDialogOpen, setPollDialogOpen] = useState(false);
  const [pendingPollId, setPendingPollId] = useState<string | null>(null);
  const [pendingNewsId, setPendingNewsId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  // Persists the search text after the user taps a result so highlights
  // remain visible on the jumped-to message. Cleared when the highlight
  // ring fades (via effect below on highlightedMessageId).
  const [highlightQuery, setHighlightQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [showEditGroupDialog, setShowEditGroupDialog] = useState(false);
  const [pinVaultSheetOpen, setPinVaultSheetOpen] = useState(false);
  const chatReady = useChatPageReady();
  const pinnedVault = useChatPinnedVault("group", groupId, { enabled: chatReady });
  const [showDeleteGroupDialog, setShowDeleteGroupDialog] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  // When the highlight ring clears, drop the persisted search highlight too.
  useEffect(() => {
    if (!highlightedMessageId && highlightQuery) setHighlightQuery("");
  }, [highlightedMessageId, highlightQuery]);
  const [hasOlderMessages, setHasOlderMessages] = useState(true);
  const [jumpRenderNonce, setJumpRenderNonce] = useState<number | string | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const useVirtualizedChat = true;
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  const isNativePlatform = Capacitor.isNativePlatform();

  // Mark group message notifications as read when opening this thread
  useEffect(() => {
    if (!user || !groupId) return;
    markChatScopeNotificationsRead({
      userId: user.id,
      scope: { kind: "group", groupId },
      queryClient,
      decrementUnreadCount,
      refreshUnreadCount,
    });
  }, [user, groupId, refreshUnreadCount, decrementUnreadCount, queryClient]);

  // AI Chat Recap wiring.
  useEffect(() => { if (groupId) markChatOpened("group", groupId); }, [groupId]);
  const summarizeTriggerRef = useRef<(() => void) | null>(null);
  const { featureDisabled: aiCatchUpDisabled } = useAICatchUpAvailability("group", groupId);
  const { data: groupUnreadCount = 0 } = useUnreadMessageCounts<number>(user?.id ?? null, {
    enabled: !!groupId,
    select: (d) => (groupId ? d.groups[groupId] ?? 0 : 0),
  });


  
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
  const nativeKbHeight = useNativeKeyboardBottomInset();

  const scrollToBottom = useCallback(() => {
    virtualHandleRef.current?.scrollToBottom("auto");
  }, []);

  const urlMessageId = searchParams.get("message");
  const [liveJump, setLiveJump] = useState<PendingChatJumpPayload | null>(null);
  useEffect(() => subscribePendingChatJump(setLiveJump), []);
  const liveJumpId = liveJump?.kind === "group" && liveJump.targetId === groupId ? liveJump.messageId : null;
  const urlJumpNonce = searchParams.get("jump");
  const [fallbackJumpId] = useState(() =>
    groupId ? consumePendingChatJump("group", groupId) : null,
  );
  const fallbackJumpTs = getLastConsumedPendingChatJumpTs(fallbackJumpId);
  const { messageId: targetMessageId, nonce: targetJumpNonce } = resolveChatJumpTarget({
    urlMessageId,
    urlJumpNonce,
    liveJumpId,
    liveJumpTs: liveJump?.ts,
    fallbackJumpId,
    fallbackJumpTs,
  });
  const targetParentId = searchParams.get("parent");

  // Diagnostics: the ChatMessagesScroller key — any change fully remounts the list.
  const scrollerKey = targetMessageId
    ? `group-jump:${groupId}:${targetMessageId}:${jumpRenderNonce ?? targetJumpNonce ?? "initial"}`
    : `group:${groupId}`;
  const scrollerKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (scrollerKeyRef.current !== null && scrollerKeyRef.current !== scrollerKey) {
      debugLogEvent("scroller-key-change", { from: scrollerKeyRef.current, to: scrollerKey });
    }
    scrollerKeyRef.current = scrollerKey;
  }, [scrollerKey]);

  // Scroll to and highlight the message referenced by ?message=… (notification deep link).
  // Optional ?parent=… provides a thread fallback if the target reply hasn't loaded yet.
  useLayoutEffect(() => {
    if (!targetMessageId) return;
    const cancel = jumpToMessageInVirtualizedChat(
      targetMessageId,
      () => localMessagesRef.current ?? [],
      () => virtualHandleRef.current,
      setHighlightedMessageId,
      {
        tryLoadOlder: () => loadOlderMessagesRef.current?.(),
        refetchLatest: () => queryClient.invalidateQueries({ queryKey: ["group-messages", groupId] }),
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
  } = usePinnedMessages("group", groupId, { enabled: chatReady });
  const handleJumpToMessage = (mid: string) =>
    jumpToMessageInVirtualizedChat(
      mid,
      () => localMessagesRef.current ?? [],
      () => virtualHandleRef.current,
      setHighlightedMessageId,
      { tryLoadOlder: () => loadOlderMessagesRef.current?.() },
    );

  const handleSearchResultClick = async (mid: string) => {
    const target = (localMessagesRef.current ?? []).find((m) => m.id === mid);
    // Preserve the query for highlighting the jumped-to row until the
    // highlight ring clears — clearing searchQuery here would strip the
    // <mark> spans mid-jump and leave the user unsure why the row matched.
    setHighlightQuery(searchQuery);
    setSearchQuery("");
    setSearchOpen(false);
    if (target?.created_at && groupId) {
      try {
        const ctx = await fetchMessagesAround({
          table: "group_messages",
          scope: { group_id: groupId },
          createdAt: target.created_at,
          selectColumns:
            "id, text, image_url, created_at, edited_at, author_id, group_id, reply_to_id, is_system_message, forwarded_from_user_id, forwarded_at, forwarded_source_label",
        });
        if (ctx.length) {
          setLocalMessages((prev) => {
            const existing = new Set((prev || []).map((m) => m.id));
            const adds = ctx.filter((m) => !existing.has(m.id));
            return adds.length ? [...(prev || []), ...adds] : prev;
          });
        }
      } catch {
        // best-effort
      }
    }
    requestAnimationFrame(() => handleJumpToMessage(mid));
  };

  // Fetch group details
  // Fetch group details.
  // `maybeSingle()` (not `single()`) so an absent/RLS-hidden row resolves to
  // `null` on a SUCCESSFUL query instead of throwing — that's what lets the
  // render gate below tell "deleted" apart from "network dropped".
  const {
    data: group,
    isLoading: groupLoading,
    isError: groupIsError,
    fetchStatus: groupFetchStatus,
    status: groupStatus,
    refetch: refetchGroup,
    isFetching: groupIsFetching,
  } = useQuery({
    queryKey: ["chat-group", groupId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_groups")
        .select("*")
        .eq("id", groupId)
        .maybeSingle();
      if (error) throw error;
      return (data as ChatGroup) ?? null;
    },
    enabled: !!groupId,
    staleTime: 5 * 60 * 1000,
  });


  const { data: miniLeagueInfo } = useQuery({
    queryKey: ["chat-group-mini-league", group?.mini_league_id],
    queryFn: async () => {
      const mlId = group?.mini_league_id;
      if (!mlId) return null;
      const { data } = await supabase
        .from("mini_leagues")
        .select("id, name, club_id")
        .eq("id", mlId)
        .maybeSingle();
      return data;
    },
    enabled: !!group?.mini_league_id,
    staleTime: 5 * 60 * 1000,
  });

  const { hasPro: clubPro, isLoading: clubProLoading } = useClubProAccess(group?.club_id ?? null, { enabled: chatReady });
  // Personal groups have no club_id, so the club lookup never resolves and the
  // menu would show Pro locks to genuine Pro users. Fall back to the user's
  // Pro access across any of their clubs in that case.
  const { hasAnyClubPro, isLoading: anyProLoading } = useUserHasAnyClubPro();
  const hasClubScope = !!group?.club_id;
  const groupClubHasPro = hasClubScope ? clubPro : hasAnyClubPro;
  const groupClubProLoading = hasClubScope ? clubProLoading : anyProLoading;
  const pinnedVaultLocked = !groupClubProLoading && !groupClubHasPro;


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
  // Batch 3A: skip when cache is provably fresh + realtime connected + page
  // wasn't just woken from background. See `shouldSkipChatMountInvalidate`.
  // Batch 3B: fire on `user?.id` (eager) when the per-surface flag is on, so
  // the invalidate lands during the same render pass as the first message
  // fetch instead of triggering a second fetch ~700ms later. The session-
  // applied check guards against firing before the JWT is on the client.
  const eagerInvalidate = isChatEagerInvalidateEnabled("group");
  const invalidateGate = eagerInvalidate ? !!user?.id : authReady;
  useEffect(() => {
    if (!groupId || !invalidateGate || !group) return;
    const key = ["group-messages", groupId];
    if (shouldSkipChatMountInvalidate(queryClient, key, `group:${groupId}`)) return;
    let cancelled = false;
    (async () => {
      if (eagerInvalidate) await ensureSessionApplied();
      if (cancelled) return;
      queryClient.invalidateQueries({ queryKey: key });
    })();
    return () => { cancelled = true; };
  }, [groupId, invalidateGate, group, queryClient, eagerInvalidate]);

  // Fetch messages with reactions - limit to MESSAGES_PER_PAGE for fast initial load
  const {
    data: messagesData,
    isLoading: messagesLoading,
    isError: messagesIsError,
    status: messagesStatus,
    fetchStatus: messagesFetchStatus,
    refetch: refetchMessages,
  } = useQuery({
    queryKey: ["group-messages", groupId],

    queryFn: async () => {
      markChatFetch();
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
          return {
            messages: attachReactionsToMessages(groupMessages, cachedReactions),
            hasOlderMessages: false,
            reactions: cachedReactions,
            fromCache: true,
          };

        }
        throw new Error("No cached messages available offline");
      }

      // Fetch messages WITHOUT profile join to avoid timeout from large avatar_url
      const { data: rawMessages, error } = await supabase
        .from("group_messages")
        .select("id, text, image_url, created_at, edited_at, author_id, group_id, reply_to_id, deleted_at, is_system_message, forwarded_from_user_id, forwarded_at, forwarded_source_label")
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
      
      const resolvedReactions = (
        reactionsResult.error ? cachedReactions : (reactionsResult.data || [])
      ) as MessageReaction[];

      return {
        // Reactions are embedded on the rows as well as returned flat, so any
        // render that seeds straight from this payload shows them immediately.
        messages: attachReactionsToMessages(messages, resolvedReactions),
        hasOlderMessages: hasMore,
        reactions: resolvedReactions,
      };

    },
    enabled: !!groupId && !!user?.id, // session token is sufficient; don't wait for profile fetch (`authReady`) to unblock first paint
    staleTime: 1000 * 60 * 5, // 5 minutes - show cache instantly
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnMount: "always", // Force refetch on every mount so reactions/messages added while away are picked up (true is a no-op while staleTime is unmet)
    refetchOnWindowFocus: false,
    placeholderData: (prev: any) => {
      if (!groupId) return undefined;
      // SECURITY (cross-group bleed): `prev` is whatever THIS hook instance
      // last rendered. When the route param changes without a remount, that is
      // the PREVIOUS group's message list — returning it verbatim renders
      // group A's messages under group B's header (and bakes them into group
      // B's offline cache). Never reuse `prev` unless every row belongs to the
      // current group.
      const prevBelongsToThisGroup =
        !!prev &&
        Array.isArray(prev.messages) &&
        prev.messages.length > 0 &&
        prev.messages.every((m: any) => !m?.group_id || m.group_id === groupId);
      // From-push freshness: prefer the just-preloaded localStorage cache
      // over a stale `prev` so the new message renders at first paint —
      // but only when the cache has a meaningful history window. A single
      // preloaded row replacing `prev` strands the user with one message
      // floating at the top of an empty viewport.
      if (openedFromNotificationRef.current) {
        const cachedData = getCachedGroupMessages(groupId);
        // Require a meaningful history window (>=5). The notification preload
        // writes a SINGLE message into cache before the chat mounts.
        const cachedHasHistory = cachedData.messages.length >= 5;
        if (cachedHasHistory) {
          return { ...cachedData, hasOlderMessages: false, fromCache: true };
        }
      }
      if (prevBelongsToThisGroup) return prev;


      const cachedData = getCachedGroupMessages(groupId);
      // A genuine one-message thread is usable; a notification-preload stub is not.
      if (!isUsableCachedThread(cachedData.messages as any)) return undefined;

      return { ...cachedData, hasOlderMessages: false, fromCache: true };
    },

  });

  // Scope key for the realtime edit/soft-delete reconciliation registry.
  const reconcileScope = `group:${groupId ?? "none"}`;

  // Extract messages and reactions from query data
  const messages = useMemo(() => {
    if (!messagesData) return [];
    const msgList = Array.isArray(messagesData) 
      ? messagesData 
      : (messagesData as any).messages || [];
    // SECURITY (cross-group bleed): last line of defence before render — a row
    // is only ever displayed in the thread it was posted to.
    const scoped = (msgList as any[]).filter((m) => !m?.group_id || m.group_id === groupId);
    // Sort by created_at to ensure proper ordering
    const sorted = [...scoped].sort((a, b) => 
      (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) || a.id.localeCompare(b.id)
    );
    // Re-apply realtime edits/soft-deletes: an older in-flight fetch resolving
    // after a realtime UPDATE must never restore pre-edit text or resurrect a
    // deleted row.
    return (reconcileMessages(reconcileScope, sorted) ?? []) as GroupMessage[];
  }, [messagesData, reconcileScope, groupId]);

  // Local copy used for rendering so optimistic updates are instant.
  // A notification-preload stub is never used as a seed, but a genuine
  // short thread is (see mem://technical/notification-preload-single-message-guard).
  const getInitialLocalMessages = () => {
    if (!groupId) return undefined;

    const cachedQueryData = queryClient.getQueryData<{ messages: GroupMessage[]; reactions: MessageReaction[] }>([
      "group-messages",
      groupId,
    ]);

    // Seeds are scoped too: a placeholder object left behind by a previous
    // group must never seed this thread's render state.
    const cachedScoped = (cachedQueryData?.messages ?? []).filter(
      (m: any) => !m?.group_id || m.group_id === groupId,
    );
    if (isUsableCachedThread(cachedScoped as any)) {
      // Merge the flat reactions array onto the rows so the seeded first paint
      // shows reactions without waiting for the merge effect.
      return attachReactionsToMessages(
        cachedScoped as GroupMessage[],
        cachedQueryData?.reactions ?? [],
      );
    }


    const fromCache = getCachedGroupMessages(groupId).messages;
    return isUsableCachedThread(fromCache as any) ? fromCache : undefined;
  };



  const [localMessages, setLocalMessages] = useState<GroupMessage[] | undefined>(() =>
    getInitialLocalMessages(),
  );
  const [infiniteScrollEnabled, setInfiniteScrollEnabled] = useState(false);
  // Realtime reactions must reach BOTH stores (query cache + localMessages) and
  // the group-specific flat reactions array.
  const reactionQueryKey = useMemo(() => ["group-messages", groupId], [groupId]);
  const { applyRealtimeReaction, applyRealtimeReactionDelete } = useRealtimeReactionSync<GroupMessage>({
    scopeKey: reconcileScope,
    // Scope guard: message_reactions realtime events are unfiltered platform-wide.
    getLocalMessages: () => localMessagesRef.current,
    queryKey: reactionQueryKey,
    setLocalMessages,
  });
  // The message_reactions realtime subscription cannot be filtered by group in
  // Postgres changes (no IN-list support), so EVERY reaction in the platform
  // reaches these handlers. Scope must be enforced here: a reaction is only
  // ours when its parent message is loaded in THIS group's stores. Without this
  // gate the flat `reactions` array grows unboundedly with other groups' rows.
  const reactionBelongsToThisGroup = useCallback(
    (groupMessageId: string | null | undefined) => {
      if (!groupMessageId) return false;
      const cached = queryClient.getQueryData<{ messages?: GroupMessage[] }>([
        "group-messages",
        groupId,
      ]);
      if (cached?.messages?.some((m) => m.id === groupMessageId)) return true;
      return Boolean(localMessagesRef.current?.some((m) => m.id === groupMessageId));
    },
    [queryClient, groupId],
  );
  const applyGroupReaction = useCallback(
    (reaction: any) => {
      if (!reaction?.id || !reaction.group_message_id) return;
      if (!reactionBelongsToThisGroup(reaction.group_message_id)) return;
      applyRealtimeReaction(reaction.group_message_id, reaction);
      queryClient.setQueryData(["group-messages", groupId], (old: any) => {
        if (!old) return old;
        const flat = (old.reactions || []) as any[];
        if (
          flat.some(
            (r) =>
              r.id === reaction.id &&
              r.user_id === reaction.user_id &&
              r.reaction_type === reaction.reaction_type,
          )
        ) {
          return old;
        }
        const kept = flat.filter(
          (r) =>
            r.id !== reaction.id &&
            !(
              r.user_id === reaction.user_id &&
              r.group_message_id === reaction.group_message_id
            ),
        );
        return { ...old, reactions: [...kept, reaction] };
      });
    },
    [applyRealtimeReaction, queryClient, groupId],
  );
  const applyGroupReactionDelete = useCallback(
    (reaction: any) => {
      if (!reaction?.id) return;
      applyRealtimeReactionDelete(reaction.group_message_id ?? null, reaction.id);
      queryClient.setQueryData(["group-messages", groupId], (old: any) => {
        if (!old) return old;
        const flat = (old.reactions || []) as any[];
        if (!flat.some((r) => r.id === reaction.id)) return old;
        return { ...old, reactions: flat.filter((r) => r.id !== reaction.id) };
      });
    },
    [applyRealtimeReactionDelete, queryClient, groupId],
  );
  const hasMeaningfulLocal = isUsableCachedThread(localMessages as any);

  // Authoritative fetched count (null = query never produced data).
  const fetchedCount = useMemo<number | null>(() => {
    if (!messagesData) return null;
    const list = (messagesData as any).messages;
    return Array.isArray(list) ? list.length : null;
  }, [messagesData]);

  // The inbox row proves this group already has at least one message, so a
  // zero-message response is inconsistent (Android resume / RLS settling)
  // rather than a legitimately empty thread.
  const inboxSaysHasMessage = useMemo(() => {
    if (!groupId) return false;
    const inboxQueries = queryClient.getQueriesData<any>({
      queryKey: ["my-chat-groups-with-messages"],
    });
    for (const [, data] of inboxQueries) {
      const latest = data?.latestMessages?.[groupId];
      if (latest && (latest.created_at || latest.text || latest.image_url)) return true;
    }
    return false;
  }, [groupId, queryClient, messagesData]);

  // Bounded automatic recovery (400ms / 1.2s / 3s) before we ever render an
  // empty thread. Same pattern as ClubAdminChatPage.
  const recoveryAttemptRef = useRef(0);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recoveryExhausted, setRecoveryExhausted] = useState(false);

  useEffect(() => {
    recoveryAttemptRef.current = 0;
    setRecoveryExhausted(false);
    if (recoveryTimerRef.current) {
      clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
  }, [groupId]);

  useEffect(() => {
    if (!groupId || !authReady) return;
    if (messagesFetchStatus === "fetching") return;
    if (fetchedCount !== null && fetchedCount > 0) {
      recoveryAttemptRef.current = 0;
      setRecoveryExhausted(false);
      return;
    }
    const needsRecovery = messagesIsError || fetchedCount === 0;
    if (!needsRecovery) return;
    if (recoveryTimerRef.current) return;

    const delay = nextEmptyRetryDelay(recoveryAttemptRef.current);
    if (delay === null) {
      setRecoveryExhausted(true);
      return;
    }
    recoveryAttemptRef.current += 1;
    recoveryTimerRef.current = setTimeout(() => {
      recoveryTimerRef.current = null;
      void refetchMessages();
    }, delay);

    return () => {
      if (recoveryTimerRef.current) {
        clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      }
    };
  }, [groupId, authReady, fetchedCount, messagesIsError, messagesFetchStatus, refetchMessages]);

  useEffect(
    () => () => {
      if (recoveryTimerRef.current) {
        clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      }
    },
    [],
  );

  const threadPhase = classifyChatThreadState({
    authReady,
    status: messagesStatus,
    fetchStatus: messagesFetchStatus,
    isError: messagesIsError,
    hasUsableCached: hasMeaningfulLocal,
    fetchedCount,
    inboxSaysHasMessage,
    recoveryExhausted,
  });
  // Latched: see useChatLoadingLatch — no skeleton regression after first paint.
  const showLoading = useChatLoadingLatch(threadPhase === "loading", groupId);


  // Android resume escape hatch: abort zombie GETs + re-issue the gating
  // queries while the page is stuck on a skeleton.
  useChatStuckWatchdog(
    (!!groupId && (groupLoading || showLoading)),
    [["chat-group", groupId], ["group-messages", groupId]],
    "group-chat",
  );


  // Cold-start stage marks (chat_mount + chat_query_return).
  useChatPerfMarks(messagesData);

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
    const flat = ((messagesData as any).reactions || []) as MessageReaction[];
    // A query response that resolves after a realtime reaction event must not
    // drop it: re-apply the recorded deltas to the flat array too.
    return reconcileFlatReactions(
      reconcileScope,
      flat as any,
      (r: any) => r.group_message_id,
      (messageId, reaction) => ({ ...reaction, group_message_id: messageId }) as any,
    ) as MessageReaction[];
    // NOTE: `localMessages` must NOT be a dependency here. This memo feeds the
    // sync useLayoutEffect below, which writes `localMessages` — including it
    // closes a state -> memo -> effect -> state cycle that trips React #185
    // ("Maximum update depth exceeded") on tap-to-react.
  }, [messagesData, reconcileScope]);
  
  // Use fresh profile data that refreshes on visibility change (fixes names vanishing after phone lock)
  const authorIds = useMemo(() => {
    return [...new Set((localMessages || []).map(m => m.author_id).filter(Boolean))];
  }, [localMessages]);
  const { getProfile } = useProfiles(authorIds);
  
  // Reset scroll state when groupId changes
  useEffect(() => {
    setLocalMessages((prev) => {
      const next = reconcileMessages(reconcileScope, getInitialLocalMessages());
      debugLogEvent("local-replace", {
        cause: "reset-effect",
        prevLen: prev?.length ?? 0,
        nextLen: next?.length ?? 0,
      });
      return next;
    });
    setHasOlderMessages(true);
    setInfiniteScrollEnabled(false);

    return () => {
      // Tombstones/patches are per-thread; drop them when leaving the thread.
      clearReconciliationScope(`group:${groupId ?? "none"}`);
    };
  }, [groupId, queryClient, reconcileScope]);

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
    // Guard: never replace existing messages with an empty array, and only
    // commit an empty thread once the classifier says it is authoritatively
    // empty (not paused/pending/recovering).
    if (!messages || !groupId) return;
    if (messages.length === 0 && localMessages && localMessages.length > 0) return;
    if (messages.length === 0 && threadPhase !== "empty") return;


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
        // SECURITY (cross-group bleed): this merge is deliberately fail-open —
        // it keeps prior rows that are absent from the incoming snapshot. A row
        // left over from another group's thread (route param changed without a
        // remount) would otherwise satisfy every keep-condition below and be
        // merged into THIS group permanently, then persisted to this group's
        // offline cache. Foreign rows are never kept.
        if (message.group_id && message.group_id !== groupId) return false;
        if (incomingIds.has(message.id)) return false;
        // A soft-deleted row is absent from `messages`; without this guard the
        // fail-open branch below would re-add it on every sync.

        // fail-open branch below would re-add it on every sync.
        if (isTombstoned(reconcileScope, message.id)) return false;
        if (message.id.startsWith("temp-") || message.id.startsWith("queued-")) {
          const key = `${message.author_id}::${message.text ?? ""}::${message.image_url ?? ""}`;
          if (realByAuthorText.has(key)) return false;
        }
        return true;
      });
      const mergedIncomingMessages = messages.map((message) => {
        // The flat reactions array is only refreshed by fetch + realtime, but
        // ChatMessage's optimistic add/remove writes to the EMBEDDED
        // message.reactions in the query cache. Union both sources so a
        // tap-to-react survives this merge; recorded realtime deletes are
        // re-applied to the final list below so a stale in-flight fetch can't
        // revive a removed row.
        const flatIncoming = incomingReactionsByMsg.get(message.id) || [];
        const embeddedIncoming = ((message as any).reactions || []) as MessageReaction[];
        const flatIds = new Set(flatIncoming.map((r) => r.id));
        const incomingReactions = [
          ...flatIncoming,
          ...embeddedIncoming.filter(
            (r) =>
              r &&
              r.id &&
              !flatIds.has(r.id) &&
              // One reaction per user per message: once the flat array holds
              // the confirmed row, drop the user's leftover temp row.
              !(r.id.startsWith("temp-") && flatIncoming.some((f) => f.user_id === r.user_id)),
          ),
        ];
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
      const mergedMessages = (reconcileReactions(
        reconcileScope,
        (reconcileMessages(
          reconcileScope,
          [...previousOnly, ...mergedIncomingMessages].sort((a, b) =>
            (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) || a.id.localeCompare(b.id),
          ),
        ) ?? []) as GroupMessage[],
      ) ?? []) as GroupMessage[];
      if (prev && mergedMessages.length < prev.length - 5) {
        debugLogEvent("local-replace", {
          cause: "merge-shrink",
          prevLen: prev.length,
          nextLen: mergedMessages.length,
          incomingLen: messages.length,
        });
      }

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

      // Identity bail-out: if merged is structurally identical to prev
      // (same IDs in same order, same reaction id-set per message, same
      // text/image_url), return prev so Virtuoso doesn't see a new `data`
      // reference and doesn't run a re-layout pass that flashes the
      // viewport blank for a frame on cold-start push taps.
      if (prev && prev.length === mergedMessages.length) {
        let identical = true;
        for (let i = 0; i < prev.length; i++) {
          const a = prev[i] as any;
          const b = mergedMessages[i] as any;
          if (
            a.id !== b.id ||
            a.text !== b.text ||
            a.image_url !== b.image_url ||
            a.reply_to_id !== b.reply_to_id
          ) { identical = false; break; }
          const ar: any[] = a.reactions || [];
          const br: any[] = b.reactions || [];
          if (ar.length !== br.length) { identical = false; break; }
          if (ar.length > 0) {
            // Compare reaction CONTENT (id + user + type), not just the id set,
            // so a temp -> confirmed reaction transition with an equal id set
            // still bails out instead of producing a new array identity on
            // every pass (React #185 guard).
            const sig = (list: any[]) =>
              list
                .map((r) => `${r.id}::${r.user_id}::${r.reaction_type}`)
                .sort()
                .join("|");
            if (sig(ar) !== sig(br)) { identical = false; break; }
          }
        }
        if (identical) return prev;
      }

      return mergedMessages;
    });
  }, [messages, reactions, groupId, threadPhase]);

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
        .select("id, text, image_url, created_at, edited_at, author_id, group_id, reply_to_id, is_system_message, forwarded_from_user_id, forwarded_at, forwarded_source_label")
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

      // Single-pass enrichment: fetch reactions, reply-to, profiles BEFORE
      // prepending. Rendering rows first as `reply_to: null` and patching them
      // a moment later causes reply pills to grow above the user's anchor —
      // visible as "messages keep moving after I stop scrolling".
      let reactionsData: any[] = [];
      let replyToData: any[] = [];
      const profilesMap = new Map<string, { display_name: string | null; avatar_url: string | null }>();

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
        reactionsData = reactionsResult.data || [];
        replyToData = replyToResult.data || [];
        cachedProfiles.forEach((p, id) => {
          profilesMap.set(id, { display_name: p.display_name, avatar_url: p.avatar_url });
        });
      } catch {
        // Continue without enrichment if it fails/timeouts.
      }

      const enrichedOlderMessages = (reconcileMessages(
        reconcileScope,
        reversedOlder.map((msg) => ({
          ...msg,
          author: profilesMap.get(msg.author_id) || null,
          reply_to: replyToData.find((r) => r.id === msg.reply_to_id) || null,
        })) as GroupMessage[],
      ) ?? []) as GroupMessage[];

      // Prepend + restore scroll anchor synchronously inside flushSync (no jolt).
      queueAnchoredPrepend(() => {
        queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[], hasOlderMessages?: boolean }>(["group-messages", groupId], (old: any) => {
          if (!old) return { messages: enrichedOlderMessages, reactions: reactionsData as MessageReaction[], hasOlderMessages: hasMore };
          const existingIds = new Set((old.messages || []).map((m: GroupMessage) => m.id));
          return {
            ...old,
            messages: [
              ...enrichedOlderMessages.filter((m) => !existingIds.has(m.id)),
              ...old.messages,
            ],
            reactions: [...(reactionsData as MessageReaction[]), ...(old.reactions || [])],
            hasOlderMessages: hasMore,
          };
        });
      });
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

  // Notification deep-links must be target-anchored, not index-estimated. On
  // repeat taps in long Grounds-style histories, the target already exists in
  // the cached array but Virtuoso can estimate `scrollToIndex` too high and
  // never mount the target row. For every fresh tap, replace first paint with a
  // small window around the exact target so the DOM row is guaranteed to exist.
  useEffect(() => {
    if (!targetMessageId || !groupId || !authReady) return;

    let cancelled = false;

    const hydrateTargetWindow = async () => {
      const { data: target, error } = await supabase
        .from("group_messages")
        .select("id, text, image_url, created_at, edited_at, author_id, group_id, reply_to_id, is_system_message, forwarded_from_user_id, forwarded_at, forwarded_source_label")
        .eq("id", targetMessageId)
        .eq("group_id", groupId)
        .is("deleted_at", null)
        .maybeSingle();

      if (cancelled || error || !target) return;

      const WINDOW_BEFORE = 12;
      const WINDOW_AFTER = 24;
      const [beforeResult, afterResult] = await Promise.all([
        supabase
          .from("group_messages")
          .select("id, text, image_url, created_at, edited_at, author_id, group_id, reply_to_id, is_system_message, forwarded_from_user_id, forwarded_at, forwarded_source_label")
          .eq("group_id", groupId)
          .is("deleted_at", null)
          .lt("created_at", target.created_at)
          .order("created_at", { ascending: false })
          .limit(WINDOW_BEFORE),
        supabase
          .from("group_messages")
          .select("id, text, image_url, created_at, edited_at, author_id, group_id, reply_to_id, is_system_message, forwarded_from_user_id, forwarded_at, forwarded_source_label")
          .eq("group_id", groupId)
          .is("deleted_at", null)
          .gt("created_at", target.created_at)
          .order("created_at", { ascending: true })
          .limit(WINDOW_AFTER),
      ]);

      if (cancelled) return;

      const existingNewer = (localMessagesRef.current || []).filter(
        (message) => new Date(message.created_at).getTime() > new Date(target.created_at).getTime(),
      );
      const rawWindow = [
        ...((beforeResult.data || []) as any[]).reverse(),
        target,
        ...((afterResult.data || []) as any[]),
        ...existingNewer,
      ];
      const byId = new Map<string, any>();
      rawWindow.forEach((message) => byId.set(message.id, message));
      const windowRows = [...byId.values()].sort(
        (a, b) => (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) || a.id.localeCompare(b.id),
      );
      const messageIds = windowRows.map((message) => message.id);
      const replyToIds = [...new Set(windowRows.filter((message) => message.reply_to_id).map((message) => message.reply_to_id as string))];
      const authorIds = [...new Set(windowRows.map((message) => message.author_id).filter(Boolean))];

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

      if (cancelled) return;

      const replyToMap = new Map((replyToResult.data || []).map((reply: any) => [reply.id, reply]));
      const reactionsByMessage = new Map<string, MessageReaction[]>();
      ((reactionsResult.data || []) as MessageReaction[]).forEach((reaction) => {
        if (!reaction.group_message_id) return;
        if (!reactionsByMessage.has(reaction.group_message_id)) reactionsByMessage.set(reaction.group_message_id, []);
        reactionsByMessage.get(reaction.group_message_id)!.push(reaction);
      });
      const anchoredWindow = windowRows.map((message: any) => {
        const author = profilesMap.get(message.author_id);
        return {
          ...message,
          author: author ? { display_name: author.display_name, avatar_url: author.avatar_url } : message.author ?? null,
          reply_to: message.reply_to_id ? replyToMap.get(message.reply_to_id) || message.reply_to || null : null,
          reactions: reactionsByMessage.get(message.id) || (message as any).reactions || [],
        } as GroupMessage;
      });

      debugLogEvent("local-replace", { cause: "jump-window", nextLen: anchoredWindow.length });
      // See TeamChatPage: only remount the scroller if the target row wasn't
      // already painted, otherwise the remount flashes blank + skeleton.
      const targetAlreadyRendered = (localMessagesRef.current || []).some((m) => m.id === targetMessageId);
      setLocalMessages((reconcileMessages(reconcileScope, anchoredWindow) ?? []) as GroupMessage[]);
      setHasOlderMessages((beforeResult.data || []).length >= WINDOW_BEFORE);
      if (!targetAlreadyRendered) setJumpRenderNonce(targetJumpNonce ?? Date.now());
    };

    void hydrateTargetWindow();

    return () => {
      cancelled = true;
    };
  }, [targetMessageId, targetJumpNonce, groupId, authReady, reconcileScope]);

  // Free-tier polling switch (only applies to groups scoped to a club).
  const { mode: groupRealtimeMode, intervalMs: groupPollIntervalMs } = useClubRealtimeMode(group?.club_id ?? null);

  useEffect(() => {
    if (!groupId || groupRealtimeMode !== "polling") return;
    const id = window.setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["group-messages", groupId] });
    }, groupPollIntervalMs);
    return () => window.clearInterval(id);
  }, [groupId, groupRealtimeMode, groupPollIntervalMs, queryClient]);

  // Real-time subscription - directly update cache instead of invalidating
  useEffect(() => {
    if (!groupId) return;
    if (groupRealtimeMode === "polling") return;

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
          const currentMessages = queryClient.getQueryData<{ messages: GroupMessage[] }>(["group-messages", groupId])?.messages;
          const localReplyMessage = findLocalReplyMessage(currentMessages, newMsg.reply_to_id);
          const localReply = localReplyMessage
            ? { text: localReplyMessage.text, author: localReplyMessage.author ?? undefined }
            : null;
          
          // IMMEDIATELY update cache with message (don't wait for profile fetch)
          queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId], (old) => {
            if (!old) return { messages: [{
              ...newMsg,
              author: cachedProfile 
                ? { display_name: cachedProfile.display_name, avatar_url: cachedProfile.avatar_url }
                : null,
              reply_to: localReply,
            }], reactions: [] };
            
            // Check if message already exists with real ID
            if (old.messages.some(m => m.id === newMsg.id)) {
              return old;
            }
            
            // Check for temp message to replace
            const tempIndex = findSupersededOptimisticIndex(old.messages, newMsg);
            
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
          const needsReplyFetch = !!newMsg.reply_to_id && !localReplyMessage;
          
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
          const deletedId = (payload.old as any)?.id;
          if (!deletedId) return;
          // Tombstone so an older in-flight fetch cannot resurrect the row.
          recordRealtimeMutation(reconcileScope, { id: deletedId, deleted_at: new Date().toISOString() });
          queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId], (old) => {
            if (!old) return { messages: [], reactions: [] };
            return { ...old, messages: removeMessage(old.messages, deletedId) };
          });
          setLocalMessages((prev) => (prev ? removeMessage(prev, deletedId) : prev));
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
          if (!updated?.id) return;
          // Record first so any query response already in flight is reconciled
          // when it lands (stale-fetch resurrection guard). Idempotent.
          const outcome = recordRealtimeMutation(reconcileScope, updated);

          if (outcome === "deleted") {
            queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId], (old) => {
              if (!old) return { messages: [], reactions: [] };
              return { ...old, messages: removeMessage(old.messages, updated.id) };
            });
            setLocalMessages((prev) => (prev ? removeMessage(prev, updated.id) : prev));
            return;
          }

          // Apply the edit to BOTH stores with the same pure helper so they
          // can never diverge. Fields absent from the payload are preserved.
          queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId], (old) => {
            if (!old) return { messages: [], reactions: [] };
            return { ...old, messages: applyMessageUpdate(old.messages, updated) };
          });
          setLocalMessages((prev) => (prev ? applyMessageUpdate(prev, updated) : prev));
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reactions" },
        (payload) => applyGroupReaction(payload.new as any),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "message_reactions" },
        (payload) => applyGroupReaction(payload.new as any),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "message_reactions" },
        (payload) => applyGroupReactionDelete(payload.old as any),
      )
      .subscribe();
    noteChannelSubscribed(`group-messages-${groupId}`);
    const unregister = user?.id
      ? registerChannel({ key: `group-messages-${groupId}`, channel, userId: user.id, scope: { kind: "group", id: groupId } })
      : null;

    return () => {
      if (unregister) unregister(); else supabase.removeChannel(channel);
      noteChannelRemoved(`group-messages-${groupId}`);
    };
  }, [groupId, queryClient, groupRealtimeMode, user?.id, reconcileScope, applyGroupReaction, applyGroupReactionDelete]);


  // Vault mirroring runs ONLY for confirmed-delivered messages, preserving the
  // group's exact folder scope (restricted roles included).
  const vaultGroupScope = useMemo(
    () =>
      group?.club_id
        ? {
            clubId: group.club_id as string,
            teamId: (group.team_id as string | null) ?? null,
            chatGroupId: group.id as string,
            chatGroupName: group.name as string,
            chatGroupAllowedRoles: (group.allowed_roles as string[] | null) ?? null,
          }
        : null,
    [group?.club_id, group?.team_id, group?.id, group?.name, group?.allowed_roles],
  );
  const syncSendToVault = useCallback(
    (vars: { text: string; image_url: string | null }) => {
      if (!user || !vaultGroupScope) return;
      if (!vars.image_url && !vars.text) return;
      import("@/lib/chatVaultSync").then(({ syncChatAttachmentToVault }) => {
        syncChatAttachmentToVault({
          imageUrl: vars.image_url,
          text: vars.text,
          userId: user.id,
          ...vaultGroupScope,
        }).catch((err) => console.warn("Group chat vault sync failed", err));
      });
    },
    [user, vaultGroupScope],
  );

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
          vault: vaultGroupScope,
        });
        return queuedSend();
      }
      
      const { error } = await supabase.from("group_messages").insert({
        group_id: groupId,
        author_id: user.id,
        text,
        image_url,
        reply_to_id,
      });
      if (error) throw error;
      return deliveredSend();
    },
    onMutate: async ({ text, image_url, reply_to_id }) => {
      const currentProfile = profileRef.current;
      await queryClient.cancelQueries({ queryKey: ["group-messages", groupId] });

      // Mutation-specific temp id so overlapping sends roll back independently.
      const tempId = createSendTempId();
      const sentAtMs = Date.now();
      const previousReplyTo = replyTo;
      const { baseText: unsentText, pollId: unsentPollId } = splitPollMarkup(text);

      const optimisticMessage: GroupMessage = {
        id: tempId,
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

      // Same batch as the composer clear (cache→local sync is a task later and
      // would step the thread down-then-up). Later sync dedupes by id.
      setLocalMessages((prev) => (prev && !prev.some((m) => m.id === tempId) ? [...prev, optimisticMessage] : prev));

      // Clear input immediately
      setMessage("");
      setImageUrl(null);
      setReplyTo(null);
      setPendingPollId(null);
      setPendingNewsId(null);
      
      // Scroll to bottom — force bypasses the touch-guard so the deferred
      // re-pins still fire after composer reflow shrinks bottomPadding.
      virtualHandleRef.current?.scrollToBottom("auto", { force: true });

      return {
        tempId,
        sentText: unsentText,
        sentImageUrl: image_url ?? null,
        previousReplyTarget: previousReplyTo,
        pendingPollId: unsentPollId,
        sentAtMs,
      } satisfies FailedSendContext<typeof previousReplyTo>;
    },
    onError: (err, variables, context) => {
      // Don't revert if offline - message is queued
      if (!navigator.onLine) {
        toast.info("Message queued - will send when online");
        return;
      }

      // Succeeded-but-errored: the row already arrived via realtime.
      const currentData = queryClient.getQueryData<{ messages: GroupMessage[] }>(["group-messages", groupId]);
      if (authoritativeMessageExists(currentData?.messages, { authorId: user?.id, text: variables.text, imageUrl: variables.image_url ?? null, replyToId: variables.reply_to_id ?? null, sentAtMs: context?.sentAtMs })) {
        // Errored request, confirmed delivery: same Vault handling as success.
        syncSendToVault(variables);
        return;
      }

      // Remove ONLY this mutation's optimistic row (no snapshot rollback).
      if (context?.tempId) {
        queryClient.setQueryData(["group-messages", groupId], (old: any) => {
          if (!old) return old;
          const existingMessages: GroupMessage[] = old?.messages || [];
          return { ...old, messages: existingMessages.filter((m) => m.id !== context.tempId) };
        });
        setLocalMessages((prev) => (prev ? prev.filter((m) => m.id !== context.tempId) : prev));
      }

      restoreFailedSendComposer({
        context,
        setText: setMessage,
        setImage: setImageUrl,
        setReply: setReplyTo,
        setPoll: setPendingPollId,
      });

      console.error("Failed to send group message", err);
      toast.error("Failed to send message");
    },

    onSuccess: (result, variables) => {
      if (isConfirmedDelivery(result)) syncSendToVault(variables);
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

      const liveData = queryClient.getQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId]);

      // Immutable pre-mutation snapshot: copy the arrays (and the reaction
      // rows themselves) so later optimistic/realtime cache writes can never
      // mutate what we roll back to after retries are exhausted.
      const previousData = liveData
        ? {
            ...liveData,
            messages: [...(liveData.messages || [])],
            reactions: (liveData.reactions || []).map((r) => ({ ...r })),
          }
        : undefined;

      // Snapshot of the rendered reaction rows for this message, used to
      // restore local render state (which is fail-open for temp reactions).
      const previousLocalReactions = ((localMessagesRef.current || []) as any[])
        .find((m: any) => m.id === messageId)
        ?.reactions?.map((r: any) => ({ ...r })) as MessageReaction[] | undefined;

      const existingReaction = previousData?.reactions.find(
        r => r.group_message_id === messageId && r.user_id === user?.id
      );
      const normalizedReactionType = normalizeGroupReactionType(reactionType);
      const normalizedExistingReactionType = normalizeGroupReactionType(existingReaction?.reaction_type);

      lastReactionIntentRef.current[messageId] = {
        reactionType: normalizedReactionType,
        action: !existingReaction ? 'add' : normalizedExistingReactionType === normalizedReactionType ? 'remove' : 'update',
      };

      const tempReactionId = `temp-reaction-${Date.now()}`;

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
          id: tempReactionId,
          user_id: user!.id,
          reaction_type: normalizedReactionType,
          group_message_id: messageId,
        };
        return { ...old, reactions: [...old.reactions, tempReaction] };
      });

      return { previousData, previousLocalReactions, existingReaction, messageId, tempReactionId };
    },
    onError: (err, variables, context) => {
      // Fires only after all retries are exhausted, so this is the single
      // final rollback.
      const currentUserId = user?.id;

      // Roll back only THIS user's reaction rows. Reactions from other users
      // that arrived via realtime while the mutation was in flight are kept,
      // so a failed rollback can't erase someone else's reaction.
      if (context?.previousData) {
        const snapshotMine = (context.previousData.reactions || []).filter(
          (r) => r.user_id === currentUserId,
        );
        queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(
          ["group-messages", groupId],
          (live) => {
            if (!live) return context.previousData!;
            const othersReactions = (live.reactions || []).filter((r) => r.user_id !== currentUserId);
            return { ...live, reactions: [...othersReactions, ...snapshotMine.map((r) => ({ ...r }))] };
          },
        );
      }

      if (context?.messageId) {
        const messageId = context.messageId;
        // The rendered list is fail-open for un-reconciled `temp-` reactions,
        // so restoring the query cache alone leaves the unsaved reaction on
        // screen. Restore this user's exact pre-interaction rows for this
        // message while preserving other users' rows.
        const snapshotMineForMessage = (context.previousLocalReactions ?? []).filter(
          (r: any) => r.user_id === currentUserId,
        );
        setLocalMessages((prev) => {
          if (!prev) return prev;
          let changed = false;
          const next = prev.map((m: any) => {
            if (m.id !== messageId) return m;
            const current: any[] = m.reactions || [];
            const restored = [
              ...current.filter((r) => r.user_id !== currentUserId),
              ...snapshotMineForMessage.map((r: any) => ({ ...r })),
            ];
            const sameSet =
              current.length === restored.length &&
              current.every((r) => restored.some((p: any) => p.id === r.id && p.reaction_type === r.reaction_type));
            if (sameSet) return m;
            changed = true;
            return { ...m, reactions: restored };
          });
          return changed ? next : prev;
        });
        delete lastReactionIntentRef.current[messageId];
      }

      toast.error("Couldn't update reaction. Please try again.");
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
    try { window.dispatchEvent(new Event("chat:message-sent")); } catch { /* noop */ }
    // Keep the composer focused through the tap. NEVER blur-to-flush the IME
    // here: on Android a blur → refocus round-trip fires a real
    // keyboardWillHide/keyboardWillShow pair, which collapses and restores
    // the chat viewport (composer drops to the bottom nav, thread grows,
    // then snaps back) — the post-send "thread jumps up and back". Composer
    // state already mirrors every IME composition update, so reading it
    // directly sends exactly what the user sees. See src/lib/chatComposerFocus.ts.
    keepComposerFocusedThroughSend(composerRef.current);

    if ((!message.trim() && !imageUrl && !pendingPollId && !pendingNewsId) || !user) return;
    if (editingMessage) {
      updateMessageMutation.mutate();
    } else {
      const baseText = message.trim();
      let finalText = pendingPollId
        ? (baseText ? `${baseText} [poll:${pendingPollId}]` : `[poll:${pendingPollId}]`)
        : baseText;
      if (pendingNewsId) {
        finalText = finalText ? `${finalText} [news:${pendingNewsId}]` : `[news:${pendingNewsId}]`;
      }
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
    inputRef.current?.focus();
    [0, 180, 480].forEach((delay) => {
      setTimeout(() => virtualHandleRef.current?.scrollToBottom("auto"), delay);
    });
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
        selectColumns: "id, text, image_url, created_at, edited_at, author_id, group_id, reply_to_id, is_system_message, forwarded_from_user_id, forwarded_at, forwarded_source_label",
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

  const firstMatchId = searchQuery.trim() ? filteredMessages?.[0]?.id ?? null : null;
  const lastCenteredKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (isSearchFetching) return;
    if (!firstMatchId) {
      lastCenteredKeyRef.current = null;
      return;
    }
    const key = `${searchQuery}|${firstMatchId}`;
    if (lastCenteredKeyRef.current === key) return;
    const idx = (filteredMessages ?? []).findIndex((m) => m.id === firstMatchId);
    if (idx < 0) return;
    lastCenteredKeyRef.current = key;
    requestAnimationFrame(() => virtualHandleRef.current?.scrollToIndex(idx, "center"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstMatchId, isSearchFetching, searchQuery]);

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

  // Stable per-message read-state objects. Group rows only render read receipts
  // on OWN messages; marking older non-own rows as read during upward scroll
  // changes readCounts/readFrontier but does not change their visible row. Keep
  // those message references stable so slow scroll does not repaint every row
  // the user has just read.
  const prevReadStateMapRef = useRef<Map<string, any>>(new Map());
  const messagesWithReadState = useMemo(() => {
    const prevMap = prevReadStateMapRef.current;
    const nextMap = new Map<string, any>();
    const out = (filteredMessages || []).map((message) => {
      const sig = message.author_id === user?.id
        ? `${readCounts[message.id] || 0}:${(readFrontier[message.id] || [])
            .map((reader) => reader.user_id)
            .join(",")}`
        : "";
      const prior = prevMap.get(message.id);
      // Reuse the prior wrapper IFF the underlying message ref AND signature
      // are unchanged. Either changing means real new content to render.
      if (prior && prior.__src === message && prior.__readStateSignature === sig) {
        nextMap.set(message.id, prior);
        return prior;
      }
      const wrapped = { ...message, __readStateSignature: sig, __src: message };
      nextMap.set(message.id, wrapped);
      return wrapped;
    });
    prevReadStateMapRef.current = nextMap;
    return out;
  }, [filteredMessages, readCounts, readFrontier, user?.id]);

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
    miniLeagueId: group?.mini_league_id ?? null,
    groupAllowedRoles: (group?.allowed_roles as any) ?? null,
    enabled: !!group && chatReady,
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
  const { withinMatchWindow: galleryWindowOpen } = useRecentMatchWindow({
    teamId: group?.team_id ?? null,
    miniLeagueId: group?.mini_league_id ?? null,
  });

  // Competition threads: the competition-wide ("all_members") thread can be
  // configured as organiser-only, in which case members read but cannot post.
  const groupCompetitionId = (group as any)?.competition_id as string | null | undefined;
  const groupCompetitionScope = (group as any)?.competition_scope as string | null | undefined;
  const { data: competitionChatSettings } = useQuery({
    queryKey: ["competition-chat-posting", groupCompetitionId, user?.id],
    enabled: !!groupCompetitionId && !!user?.id,
    queryFn: async () => {
      const [{ data: comp }, { data: isAdmin }] = await Promise.all([
        supabase
          .from("competitions")
          .select("member_chat_admins_only")
          .eq("id", groupCompetitionId!)
          .maybeSingle(),
        supabase.rpc("is_competition_admin", {
          _user_id: user!.id,
          _competition_id: groupCompetitionId!,
        }),
      ]);
      return {
        adminsOnly: !!comp?.member_chat_admins_only,
        isCompetitionAdmin: !!isAdmin,
      };
    },
  });

  const canPostInGroup = canPostInCompetitionChat({
    scope: groupCompetitionScope,
    adminsOnly: competitionChatSettings?.adminsOnly,
    isCompetitionAdmin: competitionChatSettings?.isCompetitionAdmin ?? false,
  });

  const groupBaseSublabel = group?.mini_league_id
    ? "Mini-league chat"
    : groupCompetitionId
    ? competitionChatSublabel(groupCompetitionScope)
    : group?.team_id
    ? "Team group"
    : group?.club_id
    ? "Club group"
    : "Personal group";


  const groupHeaderSublabel = groupOnlineCount > 0
    ? `${groupBaseSublabel} · ${groupOnlineCount} online`
    : groupBaseSublabel;

  const groupMetadataState = resolveChatMetadataState({
    data: group,
    isLoading: groupLoading,
    isError: groupIsError,
    fetchStatus: groupFetchStatus,
    status: groupStatus,
    isOnline,
  });

  if (groupMetadataState === "loading") {
    return <ChatPageSkeleton />;
  }

  if (groupMetadataState === "unreachable") {
    return (
      <ChatUnreachable
        label="chat group"
        onRetry={() => void refetchGroup()}
        retrying={groupIsFetching}
      />
    );
  }

  if (groupMetadataState === "missing") {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted-foreground text-center px-4">This chat group has been removed or is no longer available.</p>
        <Button variant="outline" onClick={() => navigate("/messages")}>
          Back to Messages
        </Button>
      </div>
    );
  }

  if (!group) {
    return <ChatPageSkeleton />;
  }


  // Pro gate: club-level role groups (Coaches / Team Admins / Club Committee, etc.)
  // require the club to have Pro, mirroring the club-wide chat gate.
  const isClubRoleGroup =
    !!group.club_id &&
    !group.team_id &&
    !group.mini_league_id &&
    !(group as any).competition_id &&
    Array.isArray((group as any).allowed_roles) &&
    ((group as any).allowed_roles as string[]).some((r) =>
      ["coach", "team_admin", "committee_member", "club_admin"].includes(r),
    );
  // Only show the Pro lock once the pro-access query has actually resolved.
  // Before `chatReady` flips true the query is disabled, so isLoading=false and
  // hasPro=false — without the chatReady + club_id guards the locked screen
  // flashes for one frame on cold-start push taps into a Pro club chat.
  if (isClubRoleGroup && chatReady && !!group?.club_id && !groupClubProLoading && !groupClubHasPro) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 p-4 border-b">
          <Button variant="ghost" size="icon" onClick={() => navigate("/messages")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="font-semibold">{group.name}</h1>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center py-12 px-4">
            <Lock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-lg font-medium text-foreground mb-2">Club Pro Feature</p>
            <p className="text-muted-foreground">
              {group.name} chat is available with a Club Pro subscription
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Contact your club admin to upgrade the club to Pro for role-based group messaging
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => group.club_id && navigate(`/clubs/${group.club_id}/upgrade`)}
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
              onScheduleMessage={scheduleTarget ? () => setScheduleDialogOpen(true) : undefined}
              scheduleMessageLocked={!groupClubProLoading && !groupClubHasPro}
              onSummarizeMessages={(!aiCatchUpDisabled && groupClubHasPro) ? () => summarizeTriggerRef.current?.() : undefined}
              summarizeLocked={!groupClubProLoading && !groupClubHasPro}
              onEditGroup={isAdmin ? () => setShowEditGroupDialog(true) : undefined}
              onDeleteGroup={(isAdmin || group.created_by === user?.id) ? () => setShowDeleteGroupDialog(true) : undefined}
              onManagePinnedVault={
                (isAdmin || group.created_by === user?.id)
                  ? () => {
                      if (pinnedVaultLocked) {
                        toast.info("Pinned vault is a Pro feature");
                        if (group.club_id) navigate(`/clubs/${group.club_id}/upgrade`);
                        return;
                      }
                      setPinVaultSheetOpen(true);
                    }
                  : undefined
              }
              pinnedVaultLocked={!!(isAdmin || group.created_by === user?.id) && pinnedVaultLocked}
              onUnpinVault={
                pinnedVault.record && (isAdmin || group.created_by === user?.id) && !pinnedVaultLocked
                  ? () => pinnedVault.remove()
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
        competitionId={(group as any).competition_id || undefined}
        groupAllowedRoles={group.allowed_roles}
        groupCreatedBy={group.created_by}
        groupMembershipMode={group.membership_mode}
        onInviteToMiniLeague={
          group.mini_league_id && group.club_id
            ? () => {
                setMembersOpen(false);
                setTimeout(() => setMiniLeagueInviteOpen(true), 80);
              }
            : undefined
        }
      />


      {/* Invite banner — mini-league chats */}
      {group.mini_league_id && group.club_id && (
        <>
          <button
            onClick={() => setMiniLeagueInviteOpen(true)}
            aria-label={`Invite people to ${miniLeagueInfo?.name || group.name}`}
            className="group w-full flex items-center gap-2 px-4 py-1.5 bg-primary/10 border-b border-primary/20 text-left touch-manipulation active:bg-primary/15 transition-colors shrink-0"
          >
            <div className="h-5 w-5 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
              <UserPlus className="h-3 w-3 text-primary" strokeWidth={2.25} />
            </div>
            <span className="flex-1 min-w-0 text-[13.5px] text-foreground truncate">
              Invite people to <span className="font-semibold">{miniLeagueInfo?.name || group.name}</span>
            </span>
            <ChevronRight className="h-4 w-4 text-primary/70 shrink-0" strokeWidth={2.25} />
          </button>
          {miniLeagueInviteOpen && (
            <Suspense fallback={null}>
            <AddMiniLeagueMemberSheet
              miniLeagueId={group.mini_league_id}
              miniLeagueName={miniLeagueInfo?.name || group.name}
              clubId={group.club_id}
              externalOpen={miniLeagueInviteOpen}
              onExternalOpenChange={setMiniLeagueInviteOpen}
            />
            </Suspense>
          )}
        </>
      )}


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

      {/* Pinned vault banner */}
      <PinnedVaultBanner
        record={pinnedVault.record}
        isAdmin={!!(isAdmin || group.created_by === user?.id)}
        onUnpin={
          pinnedVault.record &&
          (isAdmin || group.created_by === user?.id || pinnedVault.record.set_by === user?.id)
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

      {groupId && (
        <PinVaultSheet
          open={pinVaultSheetOpen}
          onOpenChange={setPinVaultSheetOpen}
          chatType="group"
          chatId={groupId}
          clubId={group.club_id ?? null}
          teamId={group.team_id ?? null}
        />
      )}


      <ChatCatchUp
        scope_type="group"
        scope_id={groupId}
        unreadCount={groupUnreadCount}
        latestMessageId={filteredMessages?.[filteredMessages.length - 1]?.id ?? null}
        proLocked={!groupClubProLoading && !groupClubHasPro}
        upgradeHref={group?.club_id ? `/clubs/${group.club_id}/upgrade` : undefined}
        registerTrigger={(fn) => { summarizeTriggerRef.current = fn; }}
      />

      {/* Messages */}
      <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden overscroll-none">
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
            key={scrollerKey}
            messages={messagesWithReadState}
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
            initialTargetMessageId={targetMessageId}
            renderRow={(msg, index, arr) => {
              const isOwnMessage = msg.author_id === user?.id;
              const messageReactions = messageReactionsMap.get(msg.id) || EMPTY_REACTIONS;
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
                    role={searchQuery ? "button" : undefined}
                    tabIndex={searchQuery ? 0 : undefined}
                    onClick={searchQuery ? () => handleSearchResultClick(msg.id) : undefined}
                    onKeyDown={searchQuery ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSearchResultClick(msg.id); } } : undefined}
                    className={searchQuery ? "cursor-pointer hover:bg-muted/40 rounded-lg" : undefined}
                  >
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
                      searchQuery={searchQuery || highlightQuery}
                      isPinned={pinnedMessageIds.has(msg.id)}
                      pinLimitReached={!canPinMore && !pinnedMessageIds.has(msg.id)}
                      onPin={pinMessage}
                      onUnpin={unpinMessage}
                      canPublishToGallery={galleryWindowOpen && isOwnMessage && !!msg.image_url && !msg.id.startsWith("queued-") && (!!group?.team_id || !!group?.mini_league_id)}
                      isPublishingToGallery={galleryPublishingIds.has(msg.id)}
                      isPublishedToGallery={galleryPublishedIds.has(msg.id)}
                      onPublishToGallery={handlePublishToGallery}
                      allowForwarding={group?.allow_forwarding !== false}
                      groupName={group?.name ?? null}
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


      {/* Input - Fixed at bottom above nav bar */}
      <div className={`fixed left-0 right-0 bg-background z-[49] pointer-events-none ${searchOpen ? "hidden" : ""}`} style={{ bottom: nativeKbHeight, height: nativeKbHeight > 0 ? "3rem" : "calc(var(--bottom-nav-offset, 0px) + 3rem)" }} />
        <div ref={composerRef} data-chat-chrome="true" data-chat-composer="true" className={`fixed left-0 right-0 w-full max-w-full overflow-visible border-t border-border/30 pt-1 pb-2 px-2 bg-background/95 z-[51] ${searchOpen ? "hidden" : ""}`} style={{ bottom: nativeKbHeight > 0 ? nativeKbHeight : "var(--bottom-nav-offset, 0px)" }}>
        {!canPostInGroup ? (
          <p className="py-3 text-center text-sm text-muted-foreground">
            Only competition organisers can post in this chat.
          </p>
        ) : (
        <>
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
        {scheduleTarget && <ScheduledMessagesBanner target={scheduleTarget} />}
        <ChatComposerShell
          preview={
            (pendingPollId || pendingNewsId) && !editingMessage ? (
              <div className="space-y-1.5">
                {pendingPollId && (
                  <PollAttachmentPreview
                    pollId={pendingPollId}
                    onRemove={() => setPendingPollId(null)}
                    disabled={sendMessageMutation.isPending}
                  />
                )}
                {pendingNewsId && (
                  <NewsAttachmentPreview
                    newsId={pendingNewsId}
                    onRemove={() => setPendingNewsId(null)}
                    disabled={sendMessageMutation.isPending}
                  />
                )}
              </div>
            ) : undefined
          }
        >
          <ChatImageInput 
            onImageUploaded={setImageUrl} 
            imageUrl={imageUrl} 
            clubId={group?.club_id || undefined}
            teamId={group?.team_id || undefined}
            showEventPicker={true}
            onEventSelect={() => setEventPickerOpen(true)}
            showNewsPicker={!!(group?.club_id || undefined)}
            onNewsSelect={() => setNewsPickerOpen(true)}
            showPollCreator={true}
            onPollCreate={() => setPollDialogOpen(true)}
            showBoardPicker={false}
            onBoardPick={() => setBoardPickerOpen(true)}
            showVaultPicker={!!group?.club_id}
            onAppendToken={(token) => setMessage((prev) => (prev ? `${prev} ${token}` : token))}
            hasText={!!message.trim()}
          />
          <MentionInput
            bare
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
            disabled={!message.trim() && !imageUrl && !pendingPollId && !pendingNewsId}
            loading={sendMessageMutation.isPending}
            canSend={!!message.trim() || !!imageUrl || !!pendingPollId || !!pendingNewsId}
          />
        </ChatComposerShell>
        </>
        )}

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
          miniLeagueId={group?.mini_league_id ?? null}
          competitionId={(group as any)?.competition_id ?? null}

        />
        <NewsPickerSheet
          open={newsPickerOpen}
          onOpenChange={setNewsPickerOpen}
          clubId={group?.club_id || undefined}
          onSelectNews={(newsId) => setPendingNewsId(newsId)}
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
            category: group.category,
            club_id: group.club_id,
            team_id: group.team_id,
            mini_league_id: group.mini_league_id,
            join_policy: group.join_policy,
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
              <strong>delete</strong> below.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input
            type="text"
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder="delete"
            autoCapitalize="none"
            autoCorrect="off"
            className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                if (deleteConfirmText.trim().toLowerCase() !== "delete") {
                  e.preventDefault();
                  toast.error("Type delete to confirm");
                  return;
                }
                deleteGroupMutation.mutate();
              }}
              disabled={
                deleteConfirmText.trim().toLowerCase() !== "delete" ||
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
