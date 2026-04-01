import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useChatViewportHeight } from "@/hooks/useChatViewportHeight";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Send, Loader2, Search } from "lucide-react";
import { SecureAvatar } from "@/components/SecureAvatar";
import { ChatMembersSheet } from "@/components/chat/ChatMembersSheet";
import { ChatHeaderMenu } from "@/components/chat/ChatHeaderMenu";
import { ChatSearchBar } from "@/components/chat/ChatSearch";
import { ChatMuteButton } from "@/components/chat/ChatMuteButton";
import { PageLoading } from "@/components/ui/page-loading";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { format, parseISO, isToday, isYesterday, isSameDay } from "date-fns";
import { ChatDateSeparator } from "@/components/chat/ChatDateSeparator";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { MentionInput } from "@/components/chat/MentionInput";
import { ChatImageInput } from "@/components/chat/ChatImageInput";
import { ReplyPreview } from "@/components/chat/ReplyPreview";
import { EditingBanner } from "@/components/chat/EditingBanner";

import { ChatEmptyState } from "@/components/chat/ChatEmptyState";

import { useMessageReads } from "@/hooks/useMessageReads";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { fetchProfilesWithCache, fetchSingleProfileWithCache, getProfilesFromCache, cacheProfiles } from "@/lib/profileCache";
import { useProfiles } from "@/hooks/useProfiles";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { queueMessage, getQueuedMessagesForTarget, type QueuedMessage } from "@/lib/messageQueue";
import { getCachedMessages, cacheMessages, addMessageToCache, shouldRefetchMessages } from "@/lib/messageCache";
import { Capacitor } from "@capacitor/core";
import { useNotificationNudge } from "@/hooks/useNotificationNudge";
import { NotificationNudgeBanner } from "@/components/NotificationNudgeBanner";

const MESSAGES_PER_PAGE = 15;

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

export default function TeamChatPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const { user, profile, refreshUnreadCount } = useAuth();
  const notificationNudge = useNotificationNudge(user?.id, "chat");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [message, setMessage] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<{ id: string; text: string; authorName: string | null } | null>(null);
  const [editingMessage, setEditingMessage] = useState<{ id: string; text: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const { isOnline } = useOnlineStatus();
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  const isNativePlatform = Capacitor.isNativePlatform();

  // Mark team message notifications as read when opening this thread
  useEffect(() => {
    if (!user || !teamId) return;
    
    const markNotificationsAsRead = async () => {
      await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", user.id)
        .eq("type", "team_message")
        .eq("is_read", false);
      
      // Refresh unread counts
      refreshUnreadCount();
      queryClient.invalidateQueries({ queryKey: ["unread-message-counts"] });
    };
    
    markNotificationsAsRead();
  }, [user, teamId, refreshUnreadCount, queryClient]);
  
  // Use ref to always get latest profile value in mutation callback
  const profileRef = useRef(profile);
  profileRef.current = profile;
  
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const loadTriggerRef = useRef<HTMLDivElement>(null);
  const chatHeight = useChatViewportHeight();
  
  // Scroll to bottom helper
  const scrollToBottom = useCallback(() => {
    if (!scrollAreaRef.current) return;
    
    scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
  }, []);

  // Scroll to bottom when keyboard opens (viewport shrinks)
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let prevHeight = vv.height;
    const handleResize = () => {
      const currentHeight = vv.height;
      // Keyboard opened (viewport got smaller by >100px)
      if (prevHeight - currentHeight > 100) {
        requestAnimationFrame(() => scrollToBottom());
      }
      prevHeight = currentHeight;
    };
    vv.addEventListener("resize", handleResize);
    return () => vv.removeEventListener("resize", handleResize);
  }, [scrollToBottom]);

  const targetMessageId = searchParams.get("message");

  // Set highlighted message from URL param
  useEffect(() => {
    if (targetMessageId) {
      setHighlightedMessageId(targetMessageId);
      // Clear highlight after 3 seconds
      const timer = setTimeout(() => setHighlightedMessageId(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [targetMessageId]);

  const { data: team, isLoading: loadingTeam } = useQuery({
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
    enabled: !!teamId && !!user,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const { data: messagesData, isLoading: loadingMessages, isFetching } = useQuery({
    queryKey: ["team-messages", teamId],
    queryFn: async () => {
      // If offline, return cached messages
      if (!navigator.onLine) {
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

      // Fetch messages - filter out soft-deleted messages using deleted_at
      const { data: rawMessages, error } = await supabase
        .from("team_messages")
        .select("id, text, image_url, created_at, author_id, team_id, reply_to_id, deleted_at, is_club_announcement, club_announcement_name")
        .eq("team_id", teamId!)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(MESSAGES_PER_PAGE + 1);
      if (error) throw error;
      
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
      const [reactionsResult, replyToResult, profilesMap] = await Promise.all([
        supabase
          .from("message_reactions")
          .select("id, user_id, reaction_type, team_message_id")
          .in("team_message_id", messageIds),
        replyToIds.length > 0
          ? supabase
              .from("team_messages")
              .select("id, text, author_id")
              .in("id", replyToIds)
          : Promise.resolve({ data: [] as any[] }),
        fetchProfilesWithCache(authorIds),
      ]);

      if (reactionsResult.error) {
        console.warn("[TeamChat] Failed to fetch reactions, keeping cached reactions", reactionsResult.error);
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
          : reactionsResult.data?.filter((r) => r.team_message_id === msg.id) || [];
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
        profiles: m.profiles,
        reactions: m.reactions,
        reply_to: m.reply_to,
      })));

      return { messages, hasOlderMessages: hasMore };
    },
    enabled: !!teamId,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 30, // Keep in cache for 30 minutes
    refetchOnMount: "always",
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
  });

  // Show loading only when we have no data at all (not when refetching)
  const showLoading = loadingMessages && !messagesData;

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
 
  // Track if initial scroll has happened - reset on every mount
  const hasInitialScrolled = useRef(false);
  const [infiniteScrollEnabled, setInfiniteScrollEnabled] = useState(false);
  
  // Use fresh profile data that refreshes on visibility change (fixes names vanishing after phone lock)
  const authorIds = useMemo(() => {
    return [...new Set((localMessages || []).map(m => m.author_id).filter(Boolean))];
  }, [localMessages]);
  const { getProfile } = useProfiles(authorIds);
  
  // Reset scroll state when teamId changes
  useEffect(() => {
    hasInitialScrolled.current = false;
    setInfiniteScrollEnabled(false);
  }, [teamId]);
 
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

  useEffect(() => {
    // Sync local render state with query cache without dropping newer optimistic/realtime reactions.
    if (!messages) return;

    setLocalMessages((prev) => {
      if (!prev) return messages;

      return messages.map((message) => {
        const previousMessage = prev.find((item) => item.id === message.id);
        if (!previousMessage) return message;

        const previousReactions = previousMessage.reactions || [];
        const incomingReactions = message.reactions || [];

        // Trust incoming cache state for real reactions (so removals apply instantly),
        // but keep any local temp reactions not yet confirmed by realtime/DB.
        const incomingByUser = new Map<string, typeof incomingReactions[number]>();
        incomingReactions.forEach((reaction) => {
          incomingByUser.set(reaction.user_id, reaction);
        });

        const tempOnlyFromPrevious = previousReactions.filter(
          (reaction) => reaction.id.startsWith("temp-") && !incomingByUser.has(reaction.user_id)
        );

        return {
          ...message,
          reactions: [...incomingReactions, ...tempOnlyFromPrevious],
        };
      });
    });
  }, [messages]);

  // If messages unexpectedly dropped to 0 but we had cached messages, trigger a refetch
  useEffect(() => {
    if (!teamId || loadingMessages || isFetching) return;
    
    const fetchedCount = messages?.length ?? 0;
    if (shouldRefetchMessages("team", teamId, fetchedCount)) {
      console.log("[TeamChat] Messages unexpectedly 0, triggering refetch");
      queryClient.invalidateQueries({ queryKey: ["team-messages", teamId] });
    }
  }, [teamId, messages, loadingMessages, isFetching, queryClient]);

  // Visibility change handler - refetch messages and profiles when app becomes visible (e.g., phone unlock)
  useEffect(() => {
    let lastRefresh = Date.now();
    
    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible" && teamId) {
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
  }, [teamId, queryClient]);

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

  // Scroll to bottom on initial load - poll until ScrollArea is ready
  useEffect(() => {
    if (!localMessages?.length) return;
    if (hasInitialScrolled.current) return;
    
    let attempts = 0;
    const maxAttempts = 20; // Try for up to 2 seconds
    
    const tryScroll = () => {
      attempts++;
      
      if (!scrollAreaRef.current) {
        if (attempts < maxAttempts) {
          setTimeout(tryScroll, 100);
        }
        return;
      }
      
      // Mark as scrolled and perform scroll
      hasInitialScrolled.current = true;
      setInfiniteScrollEnabled(true);
      
      // Scroll multiple times to ensure content is fully rendered
      const el = scrollAreaRef.current;
      el.scrollTop = el.scrollHeight;
      setTimeout(() => { el.scrollTop = el.scrollHeight; }, 50);
      setTimeout(() => { el.scrollTop = el.scrollHeight; }, 150);
      setTimeout(() => { el.scrollTop = el.scrollHeight; }, 300);
    };
    
    // Start polling
    tryScroll();
  }, [localMessages]);

  // Update hasOlderMessages from fetched data
  useEffect(() => {
    if (messagesData && !Array.isArray(messagesData)) {
      setHasOlderMessages((messagesData as any).hasOlderMessages ?? false);
    }
  }, [messagesData]);

  // Load older messages function with timeout protection
  const loadOlderMessages = useCallback(async () => {
    if (!localMessages?.length || isLoadingOlder || !hasOlderMessages) return;

    setIsLoadingOlder(true);

    // Preserve scroll position using container metrics only.
    // Avoid element.scrollIntoView which can scroll ancestor containers and hide the chat header.
    const scrollContainer = scrollAreaRef.current;
    const previousScrollHeight = scrollContainer?.scrollHeight ?? 0;
    const previousScrollTop = scrollContainer?.scrollTop ?? 0;

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const oldestMessage = localMessages[0];

      const { data: olderData, error } = await supabase
        .from("team_messages")
        .select("id, text, image_url, created_at, author_id, team_id, reply_to_id")
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
        profiles: profilesMap.get(msg.author_id) || null,
        reactions: reactionsData.filter((r) => r.team_message_id === msg.id) || [],
        reply_to: replyToData.find((r) => r.id === msg.reply_to_id) || null,
      })) as Message[];

      // Prepend older messages to cache (object shape)
      queryClient.setQueryData(["team-messages", teamId], (old: any) => {
        const existingMessages: Message[] = old?.messages || [];
        if (!existingMessages.length) {
          return { ...(old || {}), messages: olderMessages };
        }
        return { ...(old || {}), messages: [...olderMessages, ...existingMessages] };
      });

      // Restore the previous viewport anchor inside the chat scroller only.
      requestAnimationFrame(() => {
        const container = scrollAreaRef.current;
        if (!container) return;

        const nextScrollHeight = container.scrollHeight;
        const scrollHeightDelta = nextScrollHeight - previousScrollHeight;
        container.scrollTop = previousScrollTop + scrollHeightDelta;
      });
    } catch (err) {
      clearTimeout(timeoutId);
      console.error('Failed to load older messages:', err);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [localMessages, teamId, queryClient, isLoadingOlder, hasOlderMessages]);

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
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
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

    return () => {
      supabase.removeChannel(channel);
    };
  }, [teamId, queryClient]);

  const handleReply = useCallback((m: { id: string; text: string; authorName: string | null }) => {
    // Don't allow replying to optimistic or queued messages (temp/queued IDs)
    if (m.id.startsWith('temp-') || m.id.startsWith('queued-')) {
      toast.error("Please wait for the message to be sent before replying");
      return;
    }
    setReplyingTo(m);
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
      
      // Scroll to bottom to show new message
      scrollToBottom();

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
    onSettled: () => {
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
    if (!message.trim() && !imageUrl) return;
    if (editingMessage) {
      updateMessageMutation.mutate();
      return;
    }
    sendMessageMutation.mutate({ text: message.trim(), image_url: imageUrl, reply_to_id: replyingTo?.id || null });
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

  if (loadingTeam) {
    return <PageLoading message="Loading team chat..." />;
  }

  if (!team) {
    return <div className="py-6 text-center text-muted-foreground">Team not found</div>;
  }

  return (
    <div className="flex flex-col overflow-hidden overscroll-none" style={{ height: chatHeight, paddingBottom: "calc(var(--bottom-nav-offset, 0px) + 1rem)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background shrink-0 relative">
        <ChatSearchBar onSearch={setSearchQuery} isOpen={searchOpen} onOpenChange={setSearchOpen} />
        <Button variant="ghost" size="icon" onClick={() => navigate("/messages")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <button
          className="flex items-center gap-3 flex-1 min-w-0 active:opacity-70 transition-opacity"
          onClick={() => setMembersOpen(true)}
        >
          <SecureAvatar 
            src={team.logo_url || team.clubs?.logo_url} 
            fallback={team.name?.charAt(0)?.toUpperCase() || "T"}
            className="h-10 w-10"
            fallbackClassName="bg-secondary text-secondary-foreground"
          />
          <div className="flex-1 min-w-0 text-left">
            <h1 className="font-semibold truncate">{team.name}</h1>
            <p className="text-xs text-muted-foreground truncate">{team.clubs?.name}</p>
          </div>
        </button>
        <div className="flex items-center shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSearchOpen(true)}>
            <Search className="h-4 w-4" />
          </Button>
          <ChatMuteButton chatType="team" chatId={teamId!} />
          <ChatHeaderMenu
            onRefresh={handleManualRefresh}
            isRefreshing={isAnyRefreshing}
          />
          <ChatMembersSheet
            chatType="team"
            chatId={teamId!}
            chatName={team.name}
            externalOpen={membersOpen}
            onExternalOpenChange={setMembersOpen}
          />
        </div>
      </div>


      {/* Notification Nudge */}
      {notificationNudge.shouldShowNudge && (
        <div className="px-4 pt-2 shrink-0">
          <NotificationNudgeBanner
            message="Enable notifications so you never miss team messages"
            onDismiss={notificationNudge.dismiss}
            userId={user?.id}
          />
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 min-h-0 py-4 flex flex-col relative overflow-hidden overscroll-none">
        {showLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-3/4" />
            ))}
          </div>
        ) : filteredMessages?.length === 0 ? (
          <ChatEmptyState
            title="No messages yet"
            subtitle="Be the first to say something!"
            isSearchResult={!!searchQuery}
          />
        ) : (
          <div
            className="flex-1 min-h-0 overflow-y-auto overscroll-none scrollbar-hide"
            data-chat-scroll-lock="true"
            ref={scrollAreaRef}
            style={{ WebkitOverflowScrolling: isNativeIOS ? 'auto' : 'touch' }}
          >
            <div className="space-y-4 p-4 pb-28">
              {/* Invisible trigger for infinite scroll */}
              {hasOlderMessages && !searchQuery && (
                <div ref={loadTriggerRef} className="h-1" />
              )}
              {(filteredMessages || []).map((msg, index, arr) => {
                const currentDate = new Date(msg.created_at);
                const prevMessage = index > 0 ? arr[index - 1] : null;
                const showDateSeparator = !prevMessage || !isSameDay(currentDate, new Date(prevMessage.created_at));
                
                return (
                  <div key={msg.id}>
                    {showDateSeparator && <ChatDateSeparator date={currentDate} />}
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
                        authorName={msg.is_club_announcement ? (msg.club_announcement_name || "Club") : (getProfile(msg.author_id)?.display_name || msg.profiles?.display_name || null)}
                        authorAvatar={msg.is_club_announcement ? undefined : (getProfile(msg.author_id)?.avatar_url || msg.profiles?.avatar_url || null)}
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
                        onReply={handleReply}
                        onEdit={handleEdit}
                        searchQuery={searchQuery}
                        readFrontierReaders={readFrontier[msg.id] || []}
                        readCount={readCounts[msg.id] || 0}
                        isLastMessage={index === filteredMessages.length - 1}
                        isPending={msg.id.startsWith("queued-")}
                        contextId={teamId || ""}
                        isClubAnnouncement={msg.is_club_announcement}
                      />
                    </div>
                  </div>
                );
              })}
              <div id="team-chat-end" />
            </div>
          </div>
         )}
       </div>

      {/* Input - Fixed at bottom above nav bar */}
      <div className="fixed left-0 right-0 bg-background z-[49] pointer-events-none" style={{ bottom: 0, height: "calc(var(--bottom-nav-offset, 5rem) + 3rem)" }} />
      <div className="fixed left-0 right-0 border-t pt-1 pb-2 px-2 bg-background z-[51]" style={{ bottom: "var(--bottom-nav-offset, 5rem)" }}>
        <TypingIndicator typingUsers={typingUsers} />
        <ReplyPreview replyingTo={replyingTo} onCancel={() => setReplyingTo(null)} />
        {editingMessage && <EditingBanner text={editingMessage.text} onCancel={handleCancelEdit} />}
        <div className="flex gap-1.5 items-center">
          <ChatImageInput
            imageUrl={imageUrl}
            onImageUploaded={setImageUrl}
            disabled={sendMessageMutation.isPending}
            clubId={team?.club_id}
            teamId={teamId}
          />
          <MentionInput
            placeholder="Type a message..."
            value={message}
            onChange={(val) => {
              setMessage(val);
              if (val.trim()) startTyping();
              else stopTyping();
            }}
            onKeyPress={handleKeyPress}
            disabled={sendMessageMutation.isPending}
            teamId={teamId}
            clubId={team.club_id}
          />
          <button
            onClick={() => {
              stopTyping();
              handleSend();
            }}
            disabled={(!message.trim() && !imageUrl) || sendMessageMutation.isPending}
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