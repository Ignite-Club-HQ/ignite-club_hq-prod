import React, { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect } from "react";
import { consumePendingChatJump, getLastConsumedPendingChatJumpTs, subscribePendingChatJump, type PendingChatJumpPayload } from "@/lib/pendingChatJump";
import { resolveChatJumpTarget } from "@/lib/resolveChatJumpTarget";
import { fuzzyMatchesQuery } from "@/lib/fuzzySearch";
import { shouldGroupWithPrev } from "@/lib/chatGrouping";
import { useChatDraft } from "@/hooks/useChatDraft";
import { useChatPageReady } from "@/hooks/useChatPageReady";
import { useSyncActiveClubToChat } from "@/hooks/useSyncActiveClubToChat";
import { useChatViewportHeight } from "@/hooks/useChatViewportHeight";
import { useMeasuredElementHeight } from "@/hooks/useMeasuredElementHeight";

import { ChatMessagesScroller } from "@/components/chat/ChatMessagesScroller";
import type { VirtualizedChatMessageListHandle } from "@/components/chat/VirtualizedChatMessageList";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";
import { useNativeKeyboardHeight } from "@/hooks/useNativeKeyboardHeight";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Send, Loader2, Search, UserPlus, ChevronRight } from "lucide-react";
import { ChatBackButton } from "@/components/chat/ChatBackButton";
import { useSwipeBack } from "@/hooks/useSwipeBack";
import { SecureAvatar } from "@/components/SecureAvatar";
import { ChatHeaderShell } from "@/components/chat/ChatHeaderShell";
import { ChatDetailsSheet } from "@/components/chat/ChatDetailsSheet";
import { ChatHeaderMenu } from "@/components/chat/ChatHeaderMenu";
import { useChatOnlineCount } from "@/hooks/useChatOnlineCount";
import { ChatSearchBar, ChatSearchLoadingState } from "@/components/chat/ChatSearch";
import { useChatHistorySearch } from "@/hooks/useChatHistorySearch";
import { searchChatHistory } from "@/lib/searchChatHistory";
import { fetchMessagesAround } from "@/lib/fetchMessagesAround";

import { PageLoading } from "@/components/ui/page-loading";
import AddTeamMemberSheet from "@/components/AddTeamMemberSheet";
import AddRoleToMemberDialog from "@/components/AddRoleToMemberDialog";
import MemberDetailSheet from "@/components/MemberDetailSheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { markChatScopeNotificationsRead } from "@/lib/markChatScopeRead";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { format, parseISO, isToday, isYesterday, isSameDay } from "date-fns";
import { ChatDateSeparator } from "@/components/chat/ChatDateSeparator";
import { ChatMessage } from "@/components/chat/ChatMessage";
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
import { MentionInput } from "@/components/chat/MentionInput";
import { ChatComposerShell } from "@/components/chat/ChatComposerShell";
import { ChatImageInput } from "@/components/chat/ChatImageInput";
import { ReplyPreview } from "@/components/chat/ReplyPreview";
import { EditingBanner } from "@/components/chat/EditingBanner";
import { EventPickerSheet } from "@/components/chat/EventPickerSheet";
import { BoardPickerSheet } from "@/components/chat/BoardPickerSheet";
import { CreatePollDialog } from "@/components/chat/CreatePollDialog";
import { PollAttachmentPreview } from "@/components/chat/PollAttachmentPreview";

import { ChatEmptyState } from "@/components/chat/ChatEmptyState";

import { useMessageReads } from "@/hooks/useMessageReads";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { fetchProfilesWithCache, fetchSingleProfileWithCache, getProfilesFromCache, cacheProfiles } from "@/lib/profileCache";
import { useProfiles } from "@/hooks/useProfiles";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { queueMessage, getQueuedMessagesForTarget, type QueuedMessage } from "@/lib/messageQueue";
import { getCachedMessages, cacheMessages, addMessageToCache, shouldRefetchMessages } from "@/lib/messageCache";
import { consumeFromNotificationFlag } from "@/lib/notificationPreload";
import { logChatOpenLatency } from "@/lib/chatOpenLatency";
import { getCachedTeam, getCachedClub, cacheTeam, cacheClub } from "@/lib/clubTeamCache";
import { Capacitor } from "@capacitor/core";
import { useNotificationNudge } from "@/hooks/useNotificationNudge";
import { hapticImpactLight } from "@/lib/haptics";
import { NotificationNudgeBanner } from "@/components/NotificationNudgeBanner";
import { noteChatMount, noteChatUnmount, noteChannelSubscribed, noteChannelRemoved } from "@/lib/chatPerfDiagnostics";
import { shouldSkipChatMountInvalidate } from "@/lib/chatMountInvalidate";
import { isChatEagerInvalidateEnabled, ensureSessionApplied } from "@/lib/chatEagerInvalidate";


const MESSAGES_PER_PAGE = 30;

interface Message {
  id: string;
  team_id: string;
  author_id: string;
  text: string;
  image_url: string | null;
  reply_to_id: string | null;
  created_at: string;
  is_club_announcement?: boolean;
  club_announcement_name?: string | null;
  is_system_message?: boolean;
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

const formatMessageDate = (dateStr: string) => {
  const date = parseISO(dateStr);
  if (isToday(date)) return format(date, "h:mm a");
  if (isYesterday(date)) return `Yesterday ${format(date, "h:mm a")}`;
  return format(date, "MMM d, h:mm a");
};

const getCachedTeamMessages = (teamId: string): Message[] =>
  getCachedMessages("team", teamId).map((cachedMessage) => ({
    id: cachedMessage.id,
    team_id: teamId,
    author_id: cachedMessage.author_id,
    text: cachedMessage.text,
    image_url: cachedMessage.image_url,
    reply_to_id: cachedMessage.reply_to_id,
    created_at: cachedMessage.created_at,
    is_club_announcement: Boolean(cachedMessage.is_club_announcement),
    club_announcement_name:
      typeof cachedMessage.club_announcement_name === "string"
        ? cachedMessage.club_announcement_name
        : null,
    is_system_message: Boolean(cachedMessage.is_system_message),
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

export default function TeamChatPage() {
  // [chat-perf-diag] track mount/unmount lifetime
  React.useEffect(() => {
    const k = noteChatMount("TeamChat", null);
    return () => noteChatUnmount("TeamChat", k, null);
  }, []);
  const { teamId } = useParams<{ teamId: string }>();
  const { user, profile, refreshUnreadCount, decrementUnreadCount, initialized } = useAuth();
  const notificationNudge = useNotificationNudge(user?.id, "chat");
  const swipeBack = useSwipeBack();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const authReady = !!user && initialized;
  const [searchParams] = useSearchParams();
  // Was this thread opened from a push notification within the last 60s? If
  // so, the prior React Query snapshot (`prev`) predates the new push and is
  // stale — fall through to the freshly-preloaded localStorage cache instead
  // so the new message renders at first paint.
  const openedFromNotificationRef = useRef<number | null>(
    teamId ? consumeFromNotificationFlag("team", teamId) : null,
  );
  const mountTsRef = useRef<number>(Date.now());
  const perfLoggedRef = useRef<boolean>(false);
  const [message, setMessage, clearDraft] = useChatDraft(teamId);
  // Gate non-critical chat-page queries (pinned, vault, club-pro, online count)
  // until after first paint + idle so they don't compete with the messages
  // fetch and visual-settle window on notification opens.
  const chatReady = useChatPageReady();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<{ id: string; text: string; authorName: string | null } | null>(null);
  const [editingMessage, setEditingMessage] = useState<{ id: string; text: string } | null>(null);
  const [eventPickerOpen, setEventPickerOpen] = useState(false);
  const [boardPickerOpen, setBoardPickerOpen] = useState(false);
  const [pollDialogOpen, setPollDialogOpen] = useState(false);
  const [pendingPollId, setPendingPollId] = useState<string | null>(null);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const scheduleTarget: ScheduleTarget | null = teamId
    ? { chat_type: "team", team_id: teamId }
    : null;
  const [selectedMember, setSelectedMember] = useState<{ userId: string; displayName: string; avatarUrl?: string | null; roles: { id: string; role: string }[] } | null>(null);
  const [addRoleMember, setAddRoleMember] = useState<{ userId: string; userName: string; existingRoles: string[] } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  // publishing state moved to usePublishChatImage hook (declared after team load)
  const { isOnline } = useOnlineStatus();
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  const isNativePlatform = Capacitor.isNativePlatform();
  const useVirtualizedChat = true;

  // Mark team message notifications as read when opening this thread.
  // Uses optimistic + fire-and-forget to clear the bell badge immediately.
  useEffect(() => {
    if (!user || !teamId) return;
    markChatScopeNotificationsRead({
      userId: user.id,
      scope: { kind: "team", teamId },
      queryClient,
      decrementUnreadCount,
      refreshUnreadCount,
    });
  }, [user, teamId, refreshUnreadCount, decrementUnreadCount, queryClient]);
  
  // Use ref to always get latest profile value in mutation callback
  const profileRef = useRef(profile);
  profileRef.current = profile;
  
  // Legacy DOM refs are no longer required (Virtuoso owns scroll), but keep
  // the declarations so any non-scroll code paths that still touch the names
  // continue to compile. The refs are never attached to anything live.
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
  const liveJumpId = liveJump?.kind === "team" && liveJump.targetId === teamId ? liveJump.messageId : null;
  const urlJumpNonce = searchParams.get("jump");
  const [fallbackJumpId] = useState(() =>
    teamId ? consumePendingChatJump("team", teamId) : null,
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

  // Scroll to and highlight the message referenced by ?message=… (push /
  // in-app notification deep links). Polls until the message renders so it
  // works even if messages load async or live below the initial page.
  // Optional ?parent=… provides a thread fallback so the user lands in the
  // correct context if the target reply is still off-window.
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
    isLoading: pinnedMessagesLoading,
  } = usePinnedMessages("team", teamId, { enabled: chatReady });
  const handleJumpToMessage = (mid: string) =>
    jumpToMessageInVirtualizedChat(
      mid,
      () => localMessagesRef.current ?? [],
      () => virtualHandleRef.current,
      setHighlightedMessageId,
      { tryLoadOlder: () => loadOlderMessagesRef.current?.() },
    );

  // Clicking a search result jumps to the message in the full thread so the
  // user sees surrounding context. We first fetch a window of messages around
  // the match so the rows immediately before/after are present in the loaded
  // set (search alone merges only the matched row, leaving a gap).
  const handleSearchResultClick = async (mid: string) => {
    const target = (localMessagesRef.current ?? []).find((m) => m.id === mid);
    setSearchQuery("");
    setSearchOpen(false);
    if (target?.created_at && teamId) {
      try {
        const ctx = await fetchMessagesAround({
          table: "team_messages",
          scope: { team_id: teamId },
          createdAt: target.created_at,
          selectColumns:
            "id, text, image_url, created_at, author_id, team_id, reply_to_id, is_club_announcement, club_announcement_name, is_system_message, forwarded_from_user_id, forwarded_at, forwarded_source_label",
          hasAnnouncements: true,
        });
        if (ctx.length) {
          setLocalMessages((prev) => {
            const existing = new Set((prev || []).map((m) => m.id));
            const adds = ctx.filter((m) => !existing.has(m.id));
            return adds.length ? [...(prev || []), ...adds] : prev;
          });
        }
      } catch {
        // best-effort; fall through to jump
      }
    }
    requestAnimationFrame(() => handleJumpToMessage(mid));
  };

  const { data: teamData, isLoading: loadingTeam, fetchStatus: teamFetchStatus } = useQuery({
    queryKey: ["team", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("*, clubs (name, id, logo_url)")
        .eq("id", teamId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!teamId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Warm metadata cache so future opens render the header without waiting on this query.
  useEffect(() => {
    if (!teamData) return;
    cacheTeam({
      id: teamData.id,
      name: teamData.name,
      logo_url: teamData.logo_url ?? null,
      club_id: teamData.club_id,
      level_age: (teamData as any).level_age ?? null,
    });
    if (teamData.clubs) {
      cacheClub({
        id: teamData.clubs.id,
        name: teamData.clubs.name,
        logo_url: teamData.clubs.logo_url ?? null,
        sport: (teamData.clubs as any).sport ?? null,
        is_pro: (teamData.clubs as any).is_pro ?? false,
      });
    }
  }, [teamData]);

  // Synthesize a team object from cache when the network query is still loading,
  // so the header paints immediately instead of blocking on a metadata fetch.
  const team = useMemo(() => {
    if (teamData) return teamData as any;
    if (!teamId) return null;
    const cachedTeam = getCachedTeam(teamId);
    if (!cachedTeam) return null;
    const cachedClub = cachedTeam.club_id ? getCachedClub(cachedTeam.club_id) : null;
    return {
      id: cachedTeam.id,
      name: cachedTeam.name,
      logo_url: cachedTeam.logo_url,
      club_id: cachedTeam.club_id,
      clubs: cachedClub
        ? { id: cachedClub.id, name: cachedClub.name, logo_url: cachedClub.logo_url }
        : null,
    } as any;
  }, [teamData, teamId]);

  // Sync active club to this team's owning club so push-launched threads
  // don't leave the user inside the wrong club context.
  useSyncActiveClubToChat(team?.club_id);

  // Check if user is admin (team_admin, coach, club_admin, or app_admin) - parallelize queries

  const { data: isAdmin } = useQuery({
    queryKey: ["team-chat-admin", teamId, user?.id, team?.club_id],
    queryFn: async () => {
      // Run all checks in parallel
      const [teamRoleResult, clubRoleResult, appAdminResult] = await Promise.all([
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user!.id)
          .eq("team_id", teamId!)
          .in("role", ["team_admin", "coach"])
          .maybeSingle(),
        team?.club_id
          ? supabase
              .from("user_roles")
              .select("role")
              .eq("user_id", user!.id)
              .eq("club_id", team.club_id)
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
    enabled: !!teamId && authReady,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const [pinVaultSheetOpen, setPinVaultSheetOpen] = useState(false);
  const pinnedVault = useChatPinnedVault("team", teamId, { enabled: chatReady });
  const { hasPro: clubHasPro, isLoading: clubProLoading } = useClubProAccess(team?.club_id ?? null, { enabled: chatReady });
  const pinnedVaultLocked = !clubProLoading && !clubHasPro;

  const handleMemberProfileTap = useCallback(async (memberUserId: string, displayName: string, avatarUrl?: string | null) => {
    if (!teamId || !isAdmin || memberUserId === user?.id) return;

    const { data: roles, error } = await supabase
      .from("user_roles")
      .select("id, role")
      .eq("user_id", memberUserId)
      .eq("team_id", teamId);

    if (error) {
      toast.error("Failed to load member roles");
      return;
    }

    setSelectedMember({
      userId: memberUserId,
      displayName,
      avatarUrl,
      roles: roles || [],
    });
  }, [teamId, isAdmin, user?.id]);

  const handleRemoveRoleFromSelectedMember = useCallback(async (roleItem: { id: string; role: string }) => {
    if (!teamId) return;

    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("id", roleItem.id);

    if (error) {
      toast.error("Failed to remove role");
      return;
    }

    toast.success("Role removed");
    queryClient.invalidateQueries({ queryKey: ["team-messages", teamId] });
    queryClient.invalidateQueries({ queryKey: ["chat-members", "team", teamId] });
    setSelectedMember(null);
  }, [teamId, queryClient]);

  const handleRemoveSelectedMemberFromTeam = useCallback(async () => {
    if (!teamId || !selectedMember) return;

    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", selectedMember.userId)
      .eq("team_id", teamId);

    if (error) {
      toast.error("Failed to remove member");
      return;
    }

    toast.success("Member removed from team");
    queryClient.invalidateQueries({ queryKey: ["team-messages", teamId] });
    queryClient.invalidateQueries({ queryKey: ["chat-members", "team", teamId] });
    setSelectedMember(null);
  }, [teamId, selectedMember, queryClient]);

  // Force a fresh fetch whenever we land on this team chat. Push notifications
  // and inbox taps can land here while react-query still has stale data —
  // invalidating guarantees the latest message is fetched on entry.
  // Batch 3A: skip when cache is fresh + realtime up + not waking from background.
  // Batch 3B: fire on `user?.id` (eager) when per-surface flag enabled.
  const eagerInvalidateTeam = isChatEagerInvalidateEnabled("team");
  const invalidateGateTeam = eagerInvalidateTeam ? !!user?.id : authReady;
  useEffect(() => {
    if (!teamId || !invalidateGateTeam) return;
    const key = ["team-messages", teamId];
    if (shouldSkipChatMountInvalidate(queryClient, key, `team:${teamId}`)) return;
    let cancelled = false;
    (async () => {
      if (eagerInvalidateTeam) await ensureSessionApplied();
      if (cancelled) return;
      queryClient.invalidateQueries({ queryKey: key });
    })();
    return () => { cancelled = true; };
  }, [teamId, invalidateGateTeam, queryClient, eagerInvalidateTeam]);

  const { data: messagesData, isLoading: loadingMessages, isFetching } = useQuery({
    queryKey: ["team-messages", teamId],
    queryFn: async () => {
      // If offline, return cached messages using the React Query online manager
      // so native app resume does not incorrectly fall back to stale cache.
      if (!isOnline) {
        const cached = getCachedMessages("team", teamId!);
        if (cached.length > 0) {
          // Transform cached messages to include team_id
          const messagesWithTeamId = cached.map(m => ({
            ...m,
            team_id: teamId!,
            profiles: m.profiles,
            reactions: m.reactions || [],
          }));
          return { messages: messagesWithTeamId as unknown as Message[], hasOlderMessages: false, fromCache: true };
        }
        throw new Error("No cached messages available offline");
      }

      // 15s overall budget so a hung request never leaves the chat blank
      const queryAbort = new AbortController();
      const queryTimeout = setTimeout(() => queryAbort.abort(), 15000);

      // Fetch messages - filter out soft-deleted messages using deleted_at
      const { data: rawMessages, error } = await supabase
        .from("team_messages")
        .select("id, text, image_url, created_at, author_id, team_id, reply_to_id, deleted_at, is_club_announcement, club_announcement_name, is_system_message, forwarded_from_user_id, forwarded_at, forwarded_source_label")
        .eq("team_id", teamId!)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(MESSAGES_PER_PAGE + 1)
        .abortSignal(queryAbort.signal);
      if (error) {
        clearTimeout(queryTimeout);
        throw error;
      }
      
      if (!rawMessages?.length) {
        return { messages: [] as Message[], hasOlderMessages: false };
      }

      const hasMore = rawMessages.length > MESSAGES_PER_PAGE;
      const messagesToDisplay = hasMore ? rawMessages.slice(0, MESSAGES_PER_PAGE) : rawMessages;

      // Fetch reactions and reply_to data in parallel (profiles fetched separately for faster initial render)
      const messageIds = messagesToDisplay.map((m) => m.id);
      const replyToIds = messagesToDisplay
        .filter((m) => m.reply_to_id)
        .map((m) => m.reply_to_id as string);
      const authorIds = [...new Set(messagesToDisplay.map((m) => m.author_id))];

      // Preserve cached reactions when the reactions query fails transiently.
      const cachedQueryData = queryClient.getQueryData(["team-messages", teamId]) as
        | { messages?: Message[] }
        | Message[]
        | undefined;
      const cachedMessages = Array.isArray(cachedQueryData)
        ? cachedQueryData
        : cachedQueryData?.messages || [];
      const cachedReactionsByMessage = new Map<string, Message["reactions"]>();
      cachedMessages.forEach((cachedMessage) => {
        if (cachedMessage.reactions?.length) {
          cachedReactionsByMessage.set(cachedMessage.id, cachedMessage.reactions);
        }
      });
      
      // Fetch profiles with cache - will return cached data immediately if available, or fetch from DB
      // Use allSettled so a single hung/failing RPC cannot block the entire message render.
      const [reactionsSettled, replyToSettled, profilesSettled] = await Promise.allSettled([
        supabase
          .from("message_reactions")
          .select("id, user_id, reaction_type, team_message_id")
          .in("team_message_id", messageIds)
          .abortSignal(queryAbort.signal),
        replyToIds.length > 0
          ? supabase
              .from("team_messages")
              .select("id, text, author_id")
              .in("id", replyToIds)
              .abortSignal(queryAbort.signal)
          : Promise.resolve({ data: [] as any[], error: null }),
        fetchProfilesWithCache(authorIds),
      ]);
      clearTimeout(queryTimeout);

      const reactionsResult: any = reactionsSettled.status === "fulfilled"
        ? reactionsSettled.value
        : { data: null, error: reactionsSettled.reason };
      const replyToResult: any = replyToSettled.status === "fulfilled"
        ? replyToSettled.value
        : { data: [], error: replyToSettled.reason };
      const profilesMap: Map<string, any> = profilesSettled.status === "fulfilled"
        ? profilesSettled.value
        : new Map();

      if (reactionsResult.error) {
        console.warn("[TeamChat] Failed to fetch reactions, keeping cached reactions", reactionsResult.error);
      }
      if (replyToSettled.status === "rejected") {
        console.warn("[TeamChat] Failed to fetch reply-to messages", replyToSettled.reason);
      }
      if (profilesSettled.status === "rejected") {
        console.warn("[TeamChat] Failed to fetch profiles", profilesSettled.reason);
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
          : reactionsResult.data?.filter((r: any) => r.team_message_id === msg.id) || [];
        return {
          id: msg.id,
          team_id: msg.team_id,
          author_id: msg.author_id,
          text: msg.text,
          image_url: msg.image_url,
          reply_to_id: msg.reply_to_id,
          created_at: msg.created_at,
          is_club_announcement: msg.is_club_announcement || false,
          club_announcement_name: msg.club_announcement_name || null,
          is_system_message: msg.is_system_message || false,
          profiles: profile ? { display_name: profile.display_name, avatar_url: profile.avatar_url } : null,
          reactions,
          reply_to: replyTo,
        };
      }) as Message[];

      // Cache messages for offline access
      cacheMessages("team", teamId!, messages.map(m => ({
        id: m.id,
        text: m.text,
        author_id: m.author_id,
        created_at: m.created_at,
        image_url: m.image_url,
        reply_to_id: m.reply_to_id,
        is_club_announcement: m.is_club_announcement,
        club_announcement_name: m.club_announcement_name,
        is_system_message: m.is_system_message,
        profiles: m.profiles,
        reactions: m.reactions,
        reply_to: m.reply_to,
      })));

      return { messages, hasOlderMessages: hasMore };
    },
    enabled: !!teamId && !!user?.id, // session token is sufficient; don't wait for profile fetch (`authReady`) to unblock first paint
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 60 * 24, // Keep in cache for 24 hours
    refetchOnMount: true, // Always refetch on mount to pick up reactions/messages added while away
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    placeholderData: (prev: any) => {
      if (!teamId) return prev;
      // When opened from a push notification, the cached message just written
      // by the preload handler is fresher than `prev`. Prefer it so the new
      // message renders at first paint.
      if (openedFromNotificationRef.current) {
        const cachedMessages = getCachedTeamMessages(teamId);
        if (cachedMessages.length) {
          return { messages: cachedMessages, hasOlderMessages: cachedMessages.length >= MESSAGES_PER_PAGE, fromCache: true };
        }
      }
      if (prev) return prev;

      const cachedMessages = getCachedTeamMessages(teamId);
      if (!cachedMessages.length) return undefined;

      return { messages: cachedMessages, hasOlderMessages: cachedMessages.length >= MESSAGES_PER_PAGE, fromCache: true };
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
    teamId ? getCachedTeamMessages(teamId) : undefined,
  );
  const [infiniteScrollEnabled, setInfiniteScrollEnabled] = useState(false);
  const showLoading =
    (!authReady && !(localMessages?.length)) ||
    (loadingMessages && !messagesData && !(localMessages?.length));

  // Defer banner mounts until each banner's data has resolved. Banners
  // (notification nudge, pinned vault, pinned messages) resolve from async
  // queries and can pop in above the messages region post-pin, shrinking it
  // and causing a visible upward jolt. We wait until all three queries have
  // settled (with a 1500ms hard ceiling so a hanging query never blocks the
  // chat) before mounting any of them, so the messages region mounts at its
  // final height.
  const bannersDataReady =
    !notificationNudge.isLoading && !pinnedVault.isLoading && !pinnedMessagesLoading;
  const [bannersReady, setBannersReady] = useState(false);
  useEffect(() => {
    if (showLoading) {
      setBannersReady(false);
      return;
    }
    if (bannersDataReady) {
      // Yield one frame so the banner DOM commits before the scroller mounts.
      const raf = requestAnimationFrame(() => setBannersReady(true));
      return () => cancelAnimationFrame(raf);
    }
    // Hard ceiling — never let a slow query block the chat from appearing.
    const t = window.setTimeout(() => setBannersReady(true), 1500);
    return () => window.clearTimeout(t);
  }, [showLoading, bannersDataReady, teamId]);


  // Log notification-tap → first-message-render latency once per mount.
  useEffect(() => {
    if (perfLoggedRef.current) return;
    if (!teamId || !user?.id) return;
    if (showLoading) return;
    if (!localMessages || localMessages.length === 0) return;
    perfLoggedRef.current = true;
    const tapTs = openedFromNotificationRef.current;
    void logChatOpenLatency({
      kind: "team",
      targetId: teamId,
      source: tapTs ? "notification" : "cold_open",
      startTs: tapTs ?? mountTsRef.current,
      messageCount: localMessages.length,
      fromCache: !messagesData,
      userId: user.id,
    });
  }, [teamId, user?.id, showLoading, localMessages, messagesData]);
  
  // Use fresh profile data that refreshes on visibility change (fixes names vanishing after phone lock)
  const authorIds = useMemo(() => {
    return [...new Set((localMessages || []).map(m => m.author_id).filter(Boolean))];
  }, [localMessages]);
  const { getProfile } = useProfiles(authorIds);
  
  // Reset per-thread scroll/message state when teamId changes so the initial
  // bottom-pin runs against the new chat, not stale messages from the last team.
  // Prefer in-memory React Query data on re-open within the same session, then fall back to local cache.
  useEffect(() => {
    if (!teamId) {
      setLocalMessages(undefined);
      setInfiniteScrollEnabled(false);
      return;
    }

    const cachedQueryData = queryClient.getQueryData(["team-messages", teamId]) as
      | { messages?: Message[] }
      | Message[]
      | undefined;
    const inMemoryMessages = (
      Array.isArray(cachedQueryData)
        ? cachedQueryData
        : cachedQueryData?.messages || []
    ).sort((a, b) => (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) || a.id.localeCompare(b.id));

    setLocalMessages(inMemoryMessages.length > 0 ? inMemoryMessages : getCachedTeamMessages(teamId));
    setHasOlderMessages(true);
    setInfiniteScrollEnabled(false);
  }, [teamId, queryClient]);

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
    await queryClient.invalidateQueries({ queryKey: ["team-messages", teamId] });
    await queryClient.refetchQueries({ queryKey: ["team-messages", teamId], type: "active" });
  }, [queryClient, teamId]);

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
    if (!messages || !teamId || (messages.length === 0 && localMessages && localMessages.length > 0)) return;

    setLocalMessages((prev) => {
      const incomingIds = new Set(messages.map((message) => message.id));
      // Drop temp/queued optimistic messages once a real message with the same
      // author + text has arrived via realtime (prevents brief duplicate flash).
      const realByAuthorText = new Set(
        messages
          .filter((m) => !m.id.startsWith("temp-") && !m.id.startsWith("queued-"))
          .map((m) => `${m.author_id}::${m.text ?? ""}::${m.image_url ?? ""}`),
      );
      const previousOnly = (prev || []).filter((message) => {
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

            const incomingByUser = new Map<string, typeof incomingReactions[number]>();
            incomingReactions.forEach((reaction) => {
              incomingByUser.set(reaction.user_id, reaction);
            });

            // Keep reactions from prev that are NOT in the incoming set:
            // - temp reactions whose user isn't already covered
            // - real reactions (arrived via realtime) whose id isn't in incoming
            const incomingIds = new Set(incomingReactions.map((r) => r.id));
            const missingFromIncoming = previousReactions.filter((reaction) => {
              if (incomingIds.has(reaction.id)) return false;
              if (reaction.id.startsWith("temp-")) return !incomingByUser.has(reaction.user_id);
              return !incomingByUser.has(reaction.user_id);
            });

            return {
              ...message,
              is_club_announcement:
                message.is_club_announcement ?? previousMessage.is_club_announcement ?? false,
              club_announcement_name:
                message.club_announcement_name ?? previousMessage.club_announcement_name ?? null,
              is_system_message:
                message.is_system_message ?? previousMessage.is_system_message ?? false,
              profiles: message.profiles ?? previousMessage.profiles,
              reply_to: message.reply_to ?? previousMessage.reply_to,
              reactions: [...incomingReactions, ...missingFromIncoming],
            };
          });
      const mergedMessages = [...previousOnly, ...mergedIncomingMessages].sort((a, b) =>
        (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) || a.id.localeCompare(b.id),
      );

      cacheMessages("team", teamId, mergedMessages.map((m) => ({
        id: m.id,
        text: m.text,
        author_id: m.author_id,
        created_at: m.created_at,
        image_url: m.image_url,
        reply_to_id: m.reply_to_id,
        is_club_announcement: m.is_club_announcement,
        club_announcement_name: m.club_announcement_name,
        is_system_message: m.is_system_message,
        profiles: m.profiles,
        reactions: m.reactions,
        reply_to: m.reply_to,
      })));

      return mergedMessages;
    });
  }, [messages, teamId]);

  // If messages unexpectedly dropped to 0 but we had cached messages, trigger a refetch
  useEffect(() => {
    if (!teamId || !authReady || loadingMessages || isFetching) return;
    
    const fetchedCount = messages?.length ?? 0;
    if (shouldRefetchMessages("team", teamId, fetchedCount)) {
      console.log("[TeamChat] Messages unexpectedly 0, triggering refetch");
      queryClient.invalidateQueries({ queryKey: ["team-messages", teamId] });
    }
  }, [teamId, authReady, messages, loadingMessages, isFetching, queryClient]);

  // Visibility change handler - refetch messages and profiles when app becomes visible (e.g., phone unlock)
  useEffect(() => {
    let lastRefresh = Date.now();
    
    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible" && teamId && authReady) {
        const timeSinceLastRefresh = Date.now() - lastRefresh;
        // Only refresh if it's been more than 30 seconds
        if (timeSinceLastRefresh > 30000) {
          console.log("[TeamChat] App became visible, refreshing messages");
          lastRefresh = Date.now();
          await queryClient.invalidateQueries({ queryKey: ["team-messages", teamId] });
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [teamId, authReady, queryClient]);

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

  // Update hasOlderMessages from fetched data
  useEffect(() => {
    if (messagesData && !Array.isArray(messagesData)) {
      const messageCount = ((messagesData as any).messages || []).length;
      const fromCache = !!(messagesData as any).fromCache;
      setHasOlderMessages(fromCache ? messageCount >= MESSAGES_PER_PAGE : (messagesData as any).hasOlderMessages ?? false);
    }
  }, [messagesData]);

  // Keep a ref to localMessages so loadOlderMessages doesn't churn
  const localMessagesRef = useRef<Message[] | undefined>(localMessages);
  useEffect(() => {
    localMessagesRef.current = localMessages;
  }, [localMessages]);

  // Forward ref so the anchor hook can call the (yet-to-be-defined) loader.
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
        .from("team_messages")
        .select("id, text, image_url, created_at, author_id, team_id, reply_to_id, is_club_announcement, club_announcement_name, is_system_message, forwarded_from_user_id, forwarded_at, forwarded_source_label")
        .eq("team_id", teamId!)
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
            .select("id, user_id, reaction_type, team_message_id")
            .in("team_message_id", messageIds)
            .abortSignal(secondaryController.signal),
          replyToIds.length > 0
            ? supabase
                .from("team_messages")
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
        is_club_announcement: msg.is_club_announcement || false,
        club_announcement_name: msg.club_announcement_name || null,
        is_system_message: msg.is_system_message || false,
        profiles: profilesMap.get(msg.author_id) || null,
        reactions: reactionsData.filter((r) => r.team_message_id === msg.id) || [],
        reply_to: replyToData.find((r) => r.id === msg.reply_to_id) || null,
      })) as Message[];

      // Prepend older messages to cache + restore scroll anchor synchronously
      // (no jolt). The hook flushSyncs the cache update and corrects scrollTop
      // in the same task, so the user never sees the intermediate state.
      queueAnchoredPrepend(() => {
        queryClient.setQueryData(["team-messages", teamId], (old: any) => {
          const existingMessages: Message[] = old?.messages || [];
          if (!existingMessages.length) {
            return { ...(old || {}), messages: olderMessages, hasOlderMessages: hasMore };
          }
          return { ...(old || {}), messages: [...olderMessages, ...existingMessages], hasOlderMessages: hasMore };
        });
      });
    } catch (err) {
      clearTimeout(timeoutId);
      console.error('Failed to load older messages:', err);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [teamId, queryClient, isLoadingOlder, hasOlderMessages, queueAnchoredPrepend]);

  // Keep the loader ref in sync for the anchor hook to call.
  useEffect(() => {
    loadOlderMessagesRef.current = loadOlderMessages;
  }, [loadOlderMessages]);

  useEffect(() => {
    if (!teamId) return;

    const channel = supabase
      .channel(`team-messages-${teamId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "team_messages",
          filter: `team_id=eq.${teamId}`,
        },
        (payload) => {
          const newMsg = payload.new as any;
          
          // Get cached profile synchronously (instant, non-blocking)
          const { cached: cachedProfiles } = getProfilesFromCache([newMsg.author_id]);
          const cachedProfile = cachedProfiles.get(newMsg.author_id);
          
          // IMMEDIATELY update cache with message (don't wait for profile fetch)
          queryClient.setQueryData(["team-messages", teamId], (old: any) => {
            const existingMessages: Message[] = old?.messages || [];
            
            // Check if message already exists with real ID
            if (existingMessages.some(m => m.id === newMsg.id)) {
              return old;
            }
            
            // Check for temp message to replace — match by author AND text to avoid
            // replacing the wrong temp message when a user sends multiple messages quickly
            const tempIndex = existingMessages.findIndex(
              m => m.id.startsWith('temp-') && m.author_id === newMsg.author_id && m.text === newMsg.text
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
                    .from("team_messages")
                    .select("text, profiles:author_id(display_name)")
                    .eq("id", newMsg.reply_to_id)
                    .single()
                : Promise.resolve({ data: null }),
            ]).then(([profileData, replyToResult]) => {
              // Update the message with fetched data
              queryClient.setQueryData(["team-messages", teamId], (old: any) => {
                const existingMessages: Message[] = old?.messages || [];
                return {
                  ...(old || {}),
                  messages: existingMessages.map(m => {
                    if (m.id !== newMsg.id) return m;
                    return {
                      ...m,
                      // Don't overwrite club announcement metadata
                      is_club_announcement: m.is_club_announcement || newMsg.is_club_announcement || false,
                      club_announcement_name: m.club_announcement_name || newMsg.club_announcement_name || null,
                      is_system_message: m.is_system_message || newMsg.is_system_message || false,
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
          table: "team_messages",
          filter: `team_id=eq.${teamId}`,
        },
        (payload) => {
          const deletedId = (payload.old as any).id;
          queryClient.setQueryData(["team-messages", teamId], (old: any) => {
            const existingMessages: Message[] = old?.messages || [];
            return {
              ...(old || {}),
              messages: existingMessages.filter(m => m.id !== deletedId),
            };
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "team_messages",
          filter: `team_id=eq.${teamId}`,
        },
        (payload) => {
          const updated = payload.new as any;
          queryClient.setQueryData(["team-messages", teamId], (old: any) => {
            const existingMessages: Message[] = old?.messages || [];
            // If message was soft-deleted, remove it from the list
            if (updated.deleted_at) {
              return { ...(old || {}), messages: existingMessages.filter(m => m.id !== updated.id) };
            }
            // Otherwise update the message content
            return {
              ...(old || {}),
              messages: existingMessages.map(m =>
                m.id === updated.id ? { ...m, text: updated.text, image_url: updated.image_url, is_club_announcement: updated.is_club_announcement ?? m.is_club_announcement, club_announcement_name: updated.club_announcement_name ?? m.club_announcement_name } : m
              ),
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
          if (!reaction.team_message_id) return;
          queryClient.setQueryData(["team-messages", teamId], (old: any) => {
            const existingMessages: Message[] = old?.messages || [];
            const updatedMessages = existingMessages.map((m) => {
              if (m.id !== reaction.team_message_id) return m;

              const existingTempIdx = m.reactions.findIndex(
                (r) => r.id.startsWith("temp-") && r.user_id === reaction.user_id
              );
              if (m.reactions.some((r) => r.id === reaction.id)) return m;

              const newReaction = { id: reaction.id, user_id: reaction.user_id, reaction_type: reaction.reaction_type };
              if (existingTempIdx !== -1) {
                const newReactions = [...m.reactions];
                newReactions[existingTempIdx] = newReaction;
                return { ...m, reactions: newReactions };
              }

              return {
                ...m,
                reactions: [...m.reactions.filter((r) => r.user_id !== reaction.user_id), newReaction],
              };
            });
            return { ...(old || {}), messages: updatedMessages };
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
          if (!reaction.team_message_id) return;
          queryClient.setQueryData(["team-messages", teamId], (old: any) => {
            const existingMessages: Message[] = old?.messages || [];
            const updatedMessages = existingMessages.map((m) => {
              if (m.id !== reaction.team_message_id) return m;

              const newReaction = { id: reaction.id, user_id: reaction.user_id, reaction_type: reaction.reaction_type };
              const hasExistingReaction = m.reactions.some((r) => r.id === reaction.id);

              if (hasExistingReaction) {
                return {
                  ...m,
                  reactions: m.reactions.map((r) => (r.id === reaction.id ? newReaction : r)),
                };
              }

              return {
                ...m,
                reactions: [...m.reactions.filter((r) => r.user_id !== reaction.user_id), newReaction],
              };
            });
            return { ...(old || {}), messages: updatedMessages };
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
          queryClient.setQueryData(["team-messages", teamId], (old: any) => {
            const existingMessages: Message[] = old?.messages || [];
            const updatedMessages = existingMessages.map((m) => ({
              ...m,
              reactions: m.reactions.filter((r) => r.id !== deletedReaction.id),
            }));
            return { ...(old || {}), messages: updatedMessages };
          });
        }
      )
      .subscribe();
    noteChannelSubscribed(`team-messages-${teamId}`);

    return () => {
      supabase.removeChannel(channel); noteChannelRemoved(`team-messages-${teamId}`);
    };
  }, [teamId, queryClient]);

  const handleReply = useCallback((m: { id: string; text: string; authorName: string | null }) => {
    // Don't allow replying to optimistic or queued messages (temp/queued IDs)
    if (m.id.startsWith('temp-') || m.id.startsWith('queued-')) {
      toast.error("Please wait for the message to be sent before replying");
      return;
    }
    setReplyingTo(m);
    const ta = composerRef.current?.querySelector("textarea") as HTMLTextAreaElement | null;
    ta?.focus();
    // Re-pin in stages so the latest message stays above the composer as the
    // reply pill renders AND the Android keyboard finishes opening.
    [0, 180, 480].forEach((delay) => {
      setTimeout(() => virtualHandleRef.current?.scrollToBottom("auto"), delay);
    });
  }, []);

  const queryKeyMemo = useMemo(() => ["team-messages", teamId!], [teamId]);

  const sendMessageMutation = useMutation({
    mutationFn: async ({ text, image_url, reply_to_id }: { text: string; image_url: string | null; reply_to_id: string | null }) => {
      // If offline, queue the message instead
      if (!navigator.onLine) {
        queueMessage({
          type: "team",
          targetId: teamId!,
          authorId: user!.id,
          text,
          imageUrl: image_url,
          replyToId: reply_to_id,
          createdAt: new Date().toISOString(),
        });
        toast.info("Message queued - will send when online");
        return;
      }
      
      const { error } = await supabase.from("team_messages").insert({
        team_id: teamId!,
        author_id: user!.id,
        text,
        image_url,
        reply_to_id,
      });
      if (error) throw error;
    },
    onMutate: async ({ text, image_url, reply_to_id }) => {
      const currentProfile = profileRef.current;

      await queryClient.cancelQueries({ queryKey: ["team-messages", teamId] });

      const previousData = queryClient.getQueryData(["team-messages", teamId]);

      const optimisticMessage: Message = {
        id: `temp-${Date.now()}`,
        team_id: teamId!,
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
      queryClient.setQueryData(["team-messages", teamId], (old: any) => {
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
      hapticImpactLight();
      
      // Scroll to bottom to show new message — force=true bypasses the
      // "user is touching viewport" guard, which can spuriously cancel the
      // post-send re-pin if the send-button tap is still in contact when
      // the deferred frames run (composer reflow + bottomPadding shrink
      // would otherwise leave the new bubble below the visible area).
      virtualHandleRef.current?.scrollToBottom("auto", { force: true });

      return { previousData };
    },
    onError: (err, variables, context) => {
      // If offline, don't revert - message is queued
      if (!navigator.onLine) return;
      
      if (context?.previousData) {
        queryClient.setQueryData(["team-messages", teamId], context.previousData);
      }
      console.error("Failed to send team message", err);
      toast.error("Failed to send message");
    },
    onSettled: (_, __, variables) => {
      // Invalidate messages page preview so latest message shows
      queryClient.invalidateQueries({ queryKey: ["my-teams-with-messages"] });
      // Award engagement points (fire and forget)
      if (user && team?.club_id && teamId) {
        import("@/lib/engagementPoints").then(({ awardEngagementPoints }) => {
          awardEngagementPoints({
            userId: user.id,
            clubId: team.club_id,
            action: "chat_message",
            scopeId: teamId,
          }).catch(() => {});
        });
        // Auto-sync attachments/file links to vault (fire and forget)
        if (variables?.image_url || variables?.text) {
          import("@/lib/chatVaultSync").then(({ syncChatAttachmentToVault }) => {
            syncChatAttachmentToVault({
              imageUrl: variables.image_url,
              text: variables.text,
              userId: user.id,
              clubId: team.club_id,
              teamId: teamId,
            }).catch(() => {});
          });
        }
      }
    },
  });

  const updateMessageMutation = useMutation({
    mutationFn: async () => {
      if (!editingMessage) return;
      const { error } = await supabase.from("team_messages").update({ text: message.trim() }).eq("id", editingMessage.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setMessage("");
      setEditingMessage(null);
      queryClient.invalidateQueries({ queryKey: queryKeyMemo });
      // silent success
    },
    onError: () => toast.error("Failed to update message"),
  });

  const handleSend = () => {
    // Flush any in-flight IME composition (Gboard swipe-type / iOS QuickType)
    // BEFORE reading message state. Without this, a tap on Send mid-word
    // sends the partial/garbled composing fragment ("wothpur" → "without").
    // We re-focus the same element on the next tick so the on-screen keyboard
    // never actually dismisses — otherwise the viewport grows and the whole
    // thread visibly jumps up after each send.
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT")) {
      ae.blur();
      setTimeout(() => {
        handleSend();
        try { ae.focus({ preventScroll: true } as FocusOptions); } catch { /* noop */ }
      }, 0);
      return;
    }

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
    sendMessageMutation.mutate({ text: finalText, image_url: imageUrl, reply_to_id: replyingTo?.id || null });
    if (hadImage) nudgeGalleryAfterSend();
  };


  const handleEdit = useCallback((msg: { id: string; text: string }) => {
    setEditingMessage(msg);
    setMessage(msg.text);
    setReplyingTo(null);
  }, []);

  const {
    publishingIds,
    publishedIds,
    publish: handlePublishToGallery,
    nudgeAfterSend: nudgeGalleryAfterSend,
  } = usePublishChatImage({
    uploaderId: user?.id,
    teamId: teamId ?? null,
    clubId: team?.club_id ?? null,
  });

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

  // Full-history server-side search: when the user types a query, fetch any
  // matching messages older than what's already loaded and merge them in so
  // the existing client-side filter + highlight covers the entire history.
  const { isSearching: isSearchFetching, canShowEmpty: searchCanShowEmpty } = useChatHistorySearch<Message>({
    searchQuery,
    loadedMessages: localMessages,
    setMessages: (updater) => setLocalMessages((prev) => updater(prev)),
    enabled: !!teamId,
    cacheKey: `team:${teamId ?? ""}`,
    fetcher: async (q, signal) =>
      (await searchChatHistory({
        table: "team_messages",
        scope: { team_id: teamId! },
        query: q,
        signal,
        selectColumns:
          "id, text, image_url, created_at, author_id, team_id, reply_to_id, is_club_announcement, club_announcement_name, is_system_message, forwarded_from_user_id, forwarded_at, forwarded_source_label",
        hasAnnouncements: true,
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

  // Message IDs for read tracking
  const messageIds = useMemo(() => 
    (filteredMessages || []).map(m => m.id).filter(id => !id.startsWith('temp-')),
    [filteredMessages]
  );

  // Read tracking
  const { readCounts, readFrontier, markMessagesAsRead } = useMessageReads(
    "team",
    teamId || "",
    messageIds,
    user?.id
  );

  // Typing indicator
  const { typingUsers, startTyping, stopTyping } = useTypingIndicator(
    `team-${teamId}`,
    user?.id,
    profile?.display_name || undefined
  );

  // Track messages we've already marked to avoid loops
  const markedAsReadRef = useRef<Set<string>>(new Set());

  // Mark messages as read when they become visible
  useEffect(() => {
    if (!filteredMessages?.length || !user?.id) return;
    
    // Mark all non-own messages as read
    const messagesToMark = filteredMessages
      .filter(m => m.author_id !== user.id && !m.id.startsWith('temp-') && !markedAsReadRef.current.has(m.id))
      .map(m => m.id);
    
    if (messagesToMark.length > 0) {
      messagesToMark.forEach(id => markedAsReadRef.current.add(id));
      markMessagesAsRead(messagesToMark);
    }
  }, [filteredMessages, user?.id, markMessagesAsRead]);

  // Live online count for the team — only shown in the header sublabel when > 0.
  const teamOnlineCount = useChatOnlineCount("team", teamId, { enabled: chatReady });
  const onlineLabel = teamOnlineCount > 0 ? `${teamOnlineCount} online` : null;
  const teamHeaderSublabel = team?.clubs?.name
    ? onlineLabel
      ? `${team.clubs.name} · ${onlineLabel}`
      : team.clubs.name
    : onlineLabel || undefined;

  // Only block on the metadata fetch if we have nothing cached to render the header with.
  if (loadingTeam && !team) {
    return <PageLoading message="Loading team chat..." />;
  }

  // Query is paused (offline) and we have no cached team — keep showing loader
  // instead of a misleading "Team not found".
  if (teamFetchStatus === "paused" && !team) {
    return <PageLoading message="Loading team chat..." />;
  }

  if (!team) {
    return <div className="py-6 text-center text-muted-foreground">Team not found</div>;
  }

  return (
    <div className="flex min-h-0 flex-col overflow-hidden overscroll-none" style={{ height: chatHeight }} data-lock-keyboard-scroll="true" onTouchStart={swipeBack.onTouchStart} onTouchEnd={swipeBack.onTouchEnd}>
      {/* Header */}
      <ChatHeaderShell
        type="team"
        name={team.name}
        sublabel={teamHeaderSublabel}
        avatarUrl={team.logo_url || team.clubs?.logo_url}
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
                isAdmin
                  ? () => {
                      if (pinnedVaultLocked) {
                        toast.info("Pinned vault is a Pro feature");
                        if (team?.club_id) navigate(`/clubs/${team.club_id}/upgrade`);
                        return;
                      }
                      setPinVaultSheetOpen(true);
                    }
                  : undefined
              }
              pinnedVaultLocked={!!isAdmin && pinnedVaultLocked}
              pinnedVaultEnabled={pinnedVault.record ? pinnedVault.record.enabled : null}
              onTogglePinnedVault={
                pinnedVault.record && isAdmin && !pinnedVaultLocked ? (v) => pinnedVault.toggleEnabled(v) : undefined
              }
            />
          </>
        }
      />
      <ChatDetailsSheet
        open={membersOpen}
        onOpenChange={setMembersOpen}
        chatType="team"
        chatId={teamId!}
        name={team.name}
        sublabel={team.clubs?.name}
        avatarUrl={team.logo_url || team.clubs?.logo_url}
        clubId={team.club_id || undefined}
      />
      <AddTeamMemberSheet
        teamId={teamId!}
        teamName={team.name}
        clubId={team.club_id}
        teamType={(team as any).team_type || "mixed"}
        canBulkInvite={!!isAdmin}
        triggerVariant="none"
        externalOpen={inviteSheetOpen}
        onExternalOpenChange={setInviteSheetOpen}
      />
      {/* Compact pinned invite utility — single row, low visual weight */}
      <button
        onClick={() => setInviteSheetOpen(true)}
        aria-label={`Invite people to ${team.name}`}
        className="group w-full flex items-center gap-2 px-3.5 py-1.5 bg-background border-b border-border/40 text-left touch-manipulation active:bg-muted/60 transition-colors shrink-0"
      >
        <UserPlus className="h-3.5 w-3.5 text-muted-foreground shrink-0" strokeWidth={2} />
        <span className="flex-1 min-w-0 text-[12.5px] text-foreground/80 truncate">
          Invite to <span className="font-medium text-foreground">{team.name}</span>
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" strokeWidth={2} />
      </button>


      {/* Notification Nudge — deferred until after initial chat reveal to prevent post-pin jolt */}
      {bannersReady && notificationNudge.shouldShowNudge && (
        <div className="px-4 pt-2 shrink-0">
          <NotificationNudgeBanner
            message="Enable notifications so you never miss team messages"
            onDismiss={notificationNudge.dismiss}
            userId={user?.id}
          />
        </div>
      )}

      {/* Pinned vault banner — deferred to prevent post-pin layout shift */}
      {bannersReady && (
        <PinnedVaultBanner
          record={pinnedVault.record}
          isAdmin={!!isAdmin}
          onUnpin={
            pinnedVault.record && (isAdmin || pinnedVault.record.set_by === user?.id)
              ? () => pinnedVault.remove()
              : undefined
          }
        />
      )}

      {/* Pinned messages banner — deferred to prevent post-pin layout shift */}
      {bannersReady && (
        <PinnedMessagesBanner
          pins={pinnedMessages}
          onJumpToMessage={handleJumpToMessage}
          onUnpin={unpinMessage}
        />
      )}


      {teamId && (
        <PinVaultSheet
          open={pinVaultSheetOpen}
          onOpenChange={setPinVaultSheetOpen}
          chatType="team"
          chatId={teamId}
          clubId={team.club_id ?? null}
          teamId={teamId}
        />
      )}

      {/* Messages */}
      <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden overscroll-none">
        {showLoading || !bannersReady ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-3/4" />
            ))}
          </div>
        ) : (isSearchFetching || (!!searchQuery && !searchCanShowEmpty)) ? (
          <ChatSearchLoadingState />
        ) : filteredMessages?.length === 0 ? (
          <ChatEmptyState
            title="No messages yet"
            subtitle="Be the first to say something!"
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
                    role={searchQuery ? "button" : undefined}
                    tabIndex={searchQuery ? 0 : undefined}
                    onClick={searchQuery ? () => handleSearchResultClick(msg.id) : undefined}
                    onKeyDown={searchQuery ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSearchResultClick(msg.id); } } : undefined}
                    className={`transition-colors duration-500 ${
                      highlightedMessageId === msg.id ? "bg-primary/10 rounded-lg" : ""
                    } ${searchQuery ? "cursor-pointer hover:bg-muted/40 rounded-lg" : ""}`}
                  >
                    <ChatMessage
                      id={msg.id}
                      text={msg.text}
                      imageUrl={msg.image_url}
                      authorId={msg.author_id}
                      authorName={msg.is_club_announcement ? (msg.club_announcement_name || "Club") : (getProfile(msg.author_id)?.display_name || msg.profiles?.display_name || null)}
                      authorAvatar={getProfile(msg.author_id)?.avatar_url || msg.profiles?.avatar_url || null}
                      timestamp={formatMessageDate(msg.created_at)}
                      isOwn={msg.is_club_announcement ? false : msg.author_id === user?.id}
                      isAdmin={isAdmin || false}
                      reactions={msg.reactions}
                      currentUserId={user?.id}
                      messageType="team"
                      queryKey={queryKeyMemo}
                      replyToMessage={
                        msg.reply_to
                          ? { text: msg.reply_to.text, authorName: msg.reply_to.profiles?.display_name || null }
                          : null
                      }
                      hasReply={!!msg.reply_to_id}
                      onReply={handleReply}
                      onEdit={handleEdit}
                      onAuthorClick={
                        !msg.is_club_announcement && isAdmin && msg.author_id !== user?.id
                          ? () => handleMemberProfileTap(
                              msg.author_id,
                              getProfile(msg.author_id)?.display_name || msg.profiles?.display_name || "Unknown User",
                              getProfile(msg.author_id)?.avatar_url || msg.profiles?.avatar_url || null,
                            )
                          : undefined
                      }
                      searchQuery={searchQuery}
                      readFrontierReaders={readFrontier[msg.id] || []}
                      readCount={readCounts[msg.id] || 0}
                      isLastMessage={index === arr.length - 1}
                      isPending={msg.id.startsWith("queued-")}
                      contextId={teamId || ""}
                      isClubAnnouncement={msg.is_club_announcement}
                      isSystemMessage={msg.is_system_message}
                      isPinned={pinnedMessageIds.has(msg.id)}
                      canPin={!msg.is_club_announcement && !msg.id.startsWith("queued-")}
                      pinLimitReached={!canPinMore && !pinnedMessageIds.has(msg.id)}
                      onPin={pinMessage}
                      onUnpin={unpinMessage}
                      canPublishToGallery={msg.author_id === user?.id && !!msg.image_url && !msg.id.startsWith("queued-")}
                      isPublishingToGallery={publishingIds.has(msg.id)}
                      isPublishedToGallery={publishedIds.has(msg.id)}
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


      {/* Input - Fixed at bottom above nav bar */}
      <div className={`fixed left-0 right-0 bg-background z-[49] pointer-events-none ${searchOpen ? "hidden" : ""}`} style={{ bottom: nativeKbHeight, height: nativeKbHeight > 0 ? "3rem" : "calc(var(--bottom-nav-offset, 0px) + 3rem)" }} />
      <div ref={composerRef} data-chat-chrome="true" className={`fixed left-0 right-0 w-full max-w-full overflow-visible border-t border-border/30 pt-1 pb-2 px-2 bg-background/95 z-[51] ${searchOpen ? "hidden" : ""}`} style={{ bottom: nativeKbHeight > 0 ? nativeKbHeight : "var(--bottom-nav-offset, 0px)" }}>
        <TypingIndicator typingUsers={typingUsers} />
        <ReplyPreview replyingTo={replyingTo} onCancel={() => setReplyingTo(null)} />
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
          <ChatImageInput
            imageUrl={imageUrl}
            onImageUploaded={setImageUrl}
            disabled={false}
            clubId={team?.club_id}
            teamId={teamId}
            showEventPicker={true}
            onEventSelect={() => setEventPickerOpen(true)}
            showPollCreator={true}
            onPollCreate={() => setPollDialogOpen(true)}
            showBoardPicker={true}
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
            teamId={teamId}
            clubId={team.club_id}
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
          teamId={teamId}
          clubId={team?.club_id}
        />
        <BoardPickerSheet
          open={boardPickerOpen}
          onOpenChange={setBoardPickerOpen}
          onSelectBoard={(gameId) => {
            const token = `[board:${gameId}]`;
            setMessage(message ? `${message} ${token}` : token);
          }}
        />
        {teamId && (
          <CreatePollDialog
            open={pollDialogOpen}
            onOpenChange={setPollDialogOpen}
            chatType="team"
            chatId={teamId}
            onCreated={(pollId) => setPendingPollId(pollId)}
          />
        )}
      </div>

      {selectedMember && teamId && team && (
        <MemberDetailSheet
          open={!!selectedMember}
          onOpenChange={(open) => { if (!open) setSelectedMember(null); }}
          userId={selectedMember.userId}
          displayName={selectedMember.displayName}
          avatarUrl={selectedMember.avatarUrl}
          roles={selectedMember.roles}
          canManage={true}
          canMove={false}
          isSelf={selectedMember.userId === user?.id}
          showMoveAction={false}
          showRemoveAction={false}
          onAddRole={() => setAddRoleMember({
            userId: selectedMember.userId,
            userName: selectedMember.displayName,
            existingRoles: selectedMember.roles.map((r) => r.role),
          })}
          onMove={() => {}}
          onRemove={handleRemoveSelectedMemberFromTeam}
          onRemoveRole={handleRemoveRoleFromSelectedMember}
        />
      )}

      {addRoleMember && teamId && team && (
        <AddRoleToMemberDialog
          userId={addRoleMember.userId}
          userName={addRoleMember.userName}
          teamId={teamId}
          teamName={team.name}
          clubId={team.club_id}
          existingRoles={addRoleMember.existingRoles}
          open={!!addRoleMember}
          onOpenChange={(open) => {
            if (!open) {
              setAddRoleMember(null);
              queryClient.invalidateQueries({ queryKey: ["team-messages", teamId] });
              queryClient.invalidateQueries({ queryKey: ["chat-members", "team", teamId] });
            }
          }}
        />
      )}
    </div>
  );
}
