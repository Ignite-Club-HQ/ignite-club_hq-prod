import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { MentionInput } from "@/components/chat/MentionInput";
import { ArrowLeft, Send, MoreVertical, Pencil, Trash2, Reply, SmilePlus, Loader2, Clock, Users } from "lucide-react";
import { ChatMembersSheet } from "@/components/chat/ChatMembersSheet";
import { ChatMuteButton } from "@/components/chat/ChatMuteButton";
import { PageLoading } from "@/components/ui/page-loading";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { PullToRefreshIndicator } from "@/components/chat/PullToRefreshIndicator";

const MESSAGES_PER_PAGE = 15;
import { toast } from "sonner";
import { ChatImageInput } from "@/components/chat/ChatImageInput";
// EmojiPicker is built into MentionInput
import { ReplyPreview } from "@/components/chat/ReplyPreview";
import { ChatSearch } from "@/components/chat/ChatSearch";
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
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { queueMessage, getQueuedMessagesForTarget } from "@/lib/messageQueue";
import { Capacitor } from "@capacitor/core";


const REACTION_EMOJIS = ["❤️", "🔥", "👏", "😂", "😮", "😢"];

interface GroupMessage {
  id: string;
  text: string;
  image_url: string | null;
  created_at: string;
  author_id: string;
  group_id: string;
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

interface ChatGroup {
  id: string;
  name: string;
  club_id: string | null;
  team_id: string | null;
  mini_league_id: string | null;
  allowed_roles: string[];
  created_by: string;
}

interface MessageReaction {
  id: string;
  user_id: string;
  reaction_type: string;
  group_message_id: string | null;
}

export default function GroupChatPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, profile, refreshUnreadCount } = useAuth();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<GroupMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<GroupMessage | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  const bottomInset = isNativeIOS ? "1rem" : "env(safe-area-inset-bottom, 0px)";

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const loadTriggerRef = useRef<HTMLDivElement>(null);
  
  // Scroll to bottom helper
  const scrollToBottom = useCallback(() => {
    if (!scrollAreaRef.current) return;
    
    scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
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
    enabled: !!groupId && !!user && !!group,
    staleTime: 5 * 60 * 1000,
  });

  const { isOnline } = useOnlineStatus();

  // Fetch messages with reactions - limit to MESSAGES_PER_PAGE for fast initial load
  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ["group-messages", groupId],
    queryFn: async () => {
      // If offline, return cached messages
      if (!navigator.onLine) {
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
          return { messages: groupMessages, hasOlderMessages: false, reactions: [] as MessageReaction[], fromCache: true };
        }
        throw new Error("No cached messages available offline");
      }

      // Fetch messages WITHOUT profile join to avoid timeout from large avatar_url
      const { data: rawMessages, error } = await supabase
        .from("group_messages")
        .select("id, text, image_url, created_at, author_id, group_id, reply_to_id, deleted_at")
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
      
      // Fetch reactions and reply_to data in parallel (profiles fetched separately for faster initial render)
      const messageIds = dataToDisplay.map((m) => m.id);
      const replyToIds = dataToDisplay
        .filter((m) => m.reply_to_id)
        .map((m) => m.reply_to_id as string);
      const authorIds = [...new Set(dataToDisplay.map((m) => m.author_id))];

      // Fetch profiles with cache - will return cached data immediately if available, or fetch from DB
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
        reactions: (reactionsResult.data || []) as MessageReaction[],
      };
    },
    enabled: !!groupId,
    staleTime: 1000 * 30, // 30 seconds - refetch more often to get new reactions
    gcTime: 1000 * 60 * 30,
    refetchOnMount: 'always', // Always refetch on mount to get latest reactions
    refetchOnWindowFocus: false,
  });

  const showLoading = messagesLoading && !messagesData;

  // Extract messages and reactions from query data
  const messages = useMemo(() => {
    if (!messagesData) return [];
    const msgList = Array.isArray(messagesData) 
      ? messagesData 
      : (messagesData as any).messages || [];
    // Sort by created_at to ensure proper ordering
    return [...msgList].sort((a, b) => 
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }, [messagesData]);

  // Local copy used for rendering so optimistic updates are instant
  const [localMessages, setLocalMessages] = useState<GroupMessage[] | undefined>(undefined);
 
  // Track if initial scroll has happened - reset on every mount
  const hasInitialScrolled = useRef(false);
  const [infiniteScrollEnabled, setInfiniteScrollEnabled] = useState(false);
  
  // Use fresh profile data that refreshes on visibility change (fixes names vanishing after phone lock)
  const authorIds = useMemo(() => {
    return [...new Set((localMessages || []).map(m => m.author_id).filter(Boolean))];
  }, [localMessages]);
  const { getProfile } = useProfiles(authorIds);
  
  // Reset scroll state when groupId changes
  useEffect(() => {
    hasInitialScrolled.current = false;
    setInfiniteScrollEnabled(false);
  }, [groupId]);
 
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

  const { containerRef: pullRefreshRef, isRefreshing, pullDistance, pullProgress } = usePullToRefresh({
    onRefresh: handleRefresh,
    disabled: messagesLoading,
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
    if (!groupId || messagesLoading) return;
    
    const fetchedCount = messages?.length ?? 0;
    if (shouldRefetchMessages("group", groupId, fetchedCount)) {
      console.log("[GroupChat] Messages unexpectedly 0, triggering refetch");
      queryClient.invalidateQueries({ queryKey: ["group-messages", groupId] });
    }
  }, [groupId, messages, messagesLoading, queryClient]);

  // Visibility change handler - refetch messages and profiles when app becomes visible (e.g., phone unlock)
  useEffect(() => {
    let lastRefresh = Date.now();
    
    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible" && groupId) {
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
  }, [groupId, queryClient]);

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
      
      hasInitialScrolled.current = true;
      setInfiniteScrollEnabled(true);
      
      const el = scrollAreaRef.current;
      el.scrollTop = el.scrollHeight;
      setTimeout(() => { el.scrollTop = el.scrollHeight; }, 50);
      setTimeout(() => { el.scrollTop = el.scrollHeight; }, 150);
      setTimeout(() => { el.scrollTop = el.scrollHeight; }, 300);
    };
    
    // Start polling
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
        .from("group_messages")
        .select("id, text, image_url, created_at, author_id, group_id, reply_to_id")
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
        // Continue without reactions/replies/profiles if they timeout
      }

      const olderMessages = reversedOlder.map((msg) => ({
        ...msg,
        author: profilesMap.get(msg.author_id) || null,
        reply_to: replyToData.find((r) => r.id === msg.reply_to_id) || null,
      })) as GroupMessage[];

      const olderReactions = reactionsData as MessageReaction[];

      // Prepend older messages and reactions to cache
      queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId], (old) => {
        if (!old) return { messages: olderMessages, reactions: olderReactions };
        return {
          messages: [...olderMessages, ...old.messages],
          reactions: [...olderReactions, ...old.reactions],
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
  }, [localMessages, groupId, queryClient, isLoadingOlder, hasOlderMessages]);

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

    return () => {
      supabase.removeChannel(channel);
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
    onSettled: () => {
      // Invalidate messages page preview so latest message shows
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups-with-messages"] });
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
      toast.success("Message updated");
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
  const toggleReactionMutation = useMutation({
    mutationFn: async ({ messageId, reactionType }: { messageId: string; reactionType: string }) => {
      if (!user) return { action: 'none' as const };
      
      console.log('[Reaction] Starting mutation for message:', messageId, 'type:', reactionType);
      
      // Query DATABASE directly for existing reaction (not cache - cache is modified by onMutate)
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
      
      console.log('[Reaction] Existing reaction from DB:', existingReaction);
      
      if (existingReaction) {
        if (existingReaction.reaction_type === reactionType) {
          // Same emoji - remove reaction
          console.log('[Reaction] Removing existing reaction');
          const { error } = await supabase.from("message_reactions").delete().eq("id", existingReaction.id);
          if (error) {
            console.error('[Reaction] Delete error:', error);
            throw error;
          }
          return { action: 'removed' as const, reactionId: existingReaction.id };
        } else {
          // Different emoji - update reaction
          console.log('[Reaction] Updating existing reaction to:', reactionType);
          const { data, error } = await supabase.from("message_reactions")
            .update({ reaction_type: reactionType })
            .eq("id", existingReaction.id)
            .select()
            .maybeSingle();
          if (error) {
            console.error('[Reaction] Update error:', error);
            throw error;
          }
          console.log('[Reaction] Update success:', data);
          return { action: 'updated' as const, reaction: data, oldReactionId: existingReaction.id };
        }
      } else {
        // No existing reaction - add new
        console.log('[Reaction] Adding new reaction');
        const { data, error } = await supabase.from("message_reactions").insert({
          group_message_id: messageId,
          user_id: user.id,
          reaction_type: reactionType,
        }).select().maybeSingle();
        
        if (error) {
          console.error('[Reaction] Insert error:', error);
          throw error;
        }
        console.log('[Reaction] Insert success:', data);
        return { action: 'added' as const, reaction: data };
      }
    },
    onMutate: async ({ messageId, reactionType }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["group-messages", groupId] });
      
      const previousData = queryClient.getQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId]);
      
      // Check if user already has a reaction on this message (any type)
      const existingReaction = previousData?.reactions.find(
        r => r.group_message_id === messageId && r.user_id === user?.id && !r.id.startsWith('temp-')
      );
      
      // Optimistically update reactions
      queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId], (old) => {
        if (!old) return { messages: [], reactions: [] };
        
        if (existingReaction) {
          if (existingReaction.reaction_type === reactionType) {
            // Same emoji - remove reaction optimistically
            return { ...old, reactions: old.reactions.filter(r => r.id !== existingReaction.id) };
          } else {
            // Different emoji - update reaction optimistically
            return { 
              ...old, 
              reactions: old.reactions.map(r => 
                r.id === existingReaction.id 
                  ? { ...r, reaction_type: reactionType }
                  : r
              )
            };
          }
        } else {
          // Check if there's already a temp reaction for this user on this message
          const hasTempReaction = old.reactions.some(
            r => r.id.startsWith('temp-') && r.group_message_id === messageId && r.user_id === user?.id
          );
          if (hasTempReaction) return old;
          
          // Add reaction optimistically with temp ID
          const tempReaction: MessageReaction = {
            id: `temp-reaction-${Date.now()}`,
            user_id: user!.id,
            reaction_type: reactionType,
            group_message_id: messageId,
          };
          return { ...old, reactions: [...old.reactions, tempReaction] };
        }
      });
      
      return { previousData, existingReaction };
    },
    onError: (err, variables, context) => {
      // Revert on error
      if (context?.previousData) {
        queryClient.setQueryData(["group-messages", groupId], context.previousData);
      }
      toast.error("Failed to update reaction");
    },
    onSuccess: (result) => {
      if (!result) return;
      
      queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId], (old) => {
        if (!old) return { messages: [], reactions: [] };
        
        if (result.action === 'added' && result.reaction) {
          // Remove any temp reactions for this message/user and add the real one
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
          // Replace the old reaction with the updated one
          return { 
            ...old, 
            reactions: old.reactions.map(r => 
              r.id === result.reaction.id ? result.reaction : r
            )
          };
        }
        
        return old;
      });
    },
  });

  const handleSend = () => {
    if ((!message.trim() && !imageUrl) || !user) return;
    if (editingMessage) {
      updateMessageMutation.mutate();
    } else {
      sendMessageMutation.mutate({
        text: message.trim() || (imageUrl ? "📷 Image" : ""),
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
  };

  const handleSearchResult = (messageId: string) => {
    setHighlightedMessageId(messageId);
    const element = document.getElementById(`message-${messageId}`);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => setHighlightedMessageId(null), 2000);
  };

  const filteredMessages = useMemo(() => {
    if (!localMessages) return localMessages;
    const base = !searchQuery.trim()
      ? localMessages
      : localMessages.filter((m) =>
          m.text.toLowerCase().includes(searchQuery.toLowerCase())
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
    for (const msg of (localMessages || [])) {
      map.set(msg.id, reactions.filter((r) => r.group_message_id === msg.id));
    }
    return map;
  }, [localMessages, reactions]);


  if (groupLoading) {
    return <PageLoading message="Loading group chat..." />;
  }

  if (!group) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted-foreground">Chat group not found</p>
        <Button variant="outline" onClick={() => navigate(-1)}>
          Go Back
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] overflow-hidden overscroll-none" style={{ paddingBottom: `calc(5rem + ${bottomInset})` }}>
      {/* Header - Fixed at top */}
      <div className="fixed left-0 right-0 flex items-center gap-3 p-4 border-b bg-background z-40" style={{ top: 'calc(3.5rem + env(safe-area-inset-top, 0px))' }}>
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold truncate">{group.name}</h1>
        </div>
        <div className="flex items-center shrink-0">
          <ChatMuteButton chatType="group" chatId={groupId!} />
          <ChatMembersSheet
            chatType="group"
            chatId={groupId!}
            chatName={group.name}
            teamId={group.team_id || undefined}
            clubId={group.club_id || undefined}
            groupAllowedRoles={group.allowed_roles}
          />
          <ChatSearch onSearch={setSearchQuery} />
        </div>
      </div>

      {/* Spacer for fixed header */}
      <div className="shrink-0" style={{ height: '72px' }} />

      {/* Messages */}
      <div className="flex-1 min-h-0 py-4 flex flex-col relative overflow-hidden" style={{ touchAction: 'pan-y' }} ref={pullRefreshRef}>
        <PullToRefreshIndicator
          pullDistance={pullDistance}
          pullProgress={pullProgress}
          isRefreshing={isRefreshing}
        />
        {showLoading ? (
          <p className="text-center text-muted-foreground">Loading messages...</p>
        ) : filteredMessages?.length === 0 ? (
          <ChatEmptyState
            title="No messages yet"
            subtitle="Start the conversation!"
            isSearchResult={!!searchQuery}
          />
        ) : (
          <div
            className="flex-1 h-full overflow-y-auto overscroll-none scrollbar-hide"
            ref={scrollAreaRef}
            style={{ WebkitOverflowScrolling: isNativeIOS ? 'auto' : 'touch' }}
          >
            <div className="space-y-4 p-4 pb-20">
            {/* Invisible trigger for infinite scroll */}
            {hasOlderMessages && !searchQuery && (
              <div ref={loadTriggerRef} className="flex justify-center py-2">
                {isLoadingOlder && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
            )}
            {(filteredMessages || []).map((msg, index, arr) => {
            const isOwnMessage = msg.author_id === user?.id;
            const messageReactions = messageReactionsMap.get(msg.id) || [];
            const currentDate = new Date(msg.created_at);
            const prevMessage = index > 0 ? arr[index - 1] : null;
            const showDateSeparator = !prevMessage || !isSameDay(currentDate, new Date(prevMessage.created_at));
            
            return (
              <div key={msg.id}>
                {showDateSeparator && <ChatDateSeparator date={currentDate} />}
                <div
                  id={`message-${msg.id}`}
                  className={`flex ${isOwnMessage ? "justify-end" : "justify-start"} ${
                    highlightedMessageId === msg.id ? "bg-primary/10 rounded-lg" : ""
                  }`}
                >
                  <div className={`flex gap-2 max-w-[85%] group ${isOwnMessage ? "flex-row-reverse" : ""}`}>
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarImage src={getProfile(msg.author_id)?.avatar_url || msg.author?.avatar_url || undefined} />
                      <AvatarFallback>
                        {(getProfile(msg.author_id)?.display_name || msg.author?.display_name)?.[0]?.toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    
                    <div className={`flex flex-col ${isOwnMessage ? "items-end" : "items-start"}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium">
                          {getProfile(msg.author_id)?.display_name || msg.author?.display_name || "Loading..."}
                        </span>
                        {msg.id.startsWith("queued-") && (
                          <span className="flex items-center text-amber-500" title="Pending sync">
                            <Clock className="h-3 w-3" />
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(msg.created_at), "HH:mm")}
                        </span>
                      </div>
                      
                      {msg.reply_to && (
                        <div className="text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded mb-1 border-l-2 border-primary">
                          <span className="font-medium">{msg.reply_to.author?.display_name || "..."}: </span>
                          <span className="line-clamp-1">{msg.reply_to.text}</span>
                        </div>
                      )}
                      
                      <div className={`rounded-lg px-3 py-2 ${
                        isOwnMessage ? "bg-primary text-primary-foreground" : "bg-muted"
                      }`}>
                        {msg.image_url && (
                          <img 
                            src={msg.image_url} 
                            alt="Attachment" 
                            className="max-w-xs rounded mb-2"
                          />
                        )}
                        <MessageContent text={msg.text} />
                      </div>
                      
                      {/* Read indicator */}
                      {isOwnMessage && index === arr.length - 1 ? (
                        (readFrontier[msg.id] || []).length > 0 ? (
                          <MessageReadAvatars readers={readFrontier[msg.id]} isOwn={true} />
                        ) : (
                          <div className="mt-0.5">
                            <span className="text-[10px] text-muted-foreground">Sent</span>
                          </div>
                        )
                      ) : isOwnMessage ? (
                        <div className="mt-0.5">
                          <span className="text-[10px] text-muted-foreground">
                            {(readCounts[msg.id] || 0) > 0 ? `Read by ${readCounts[msg.id]}` : "Sent"}
                          </span>
                        </div>
                      ) : null}
                      
                      {/* Reactions */}
                      <div className="flex items-center gap-1 mt-1">
                        {messageReactions.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {messageReactions.map((r) => (
                              <span key={r.id} className="text-xs bg-muted px-1 rounded">
                                {r.reaction_type}
                              </span>
                            ))}
                          </div>
                        )}
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                              <SmilePlus className="h-3 w-3" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-2">
                            <div className="flex gap-1">
                              {REACTION_EMOJIS.map((emoji) => {
                                // Check if user has ANY reaction on this message
                                const userReaction = reactions.find(
                                  r => r.group_message_id === msg.id && r.user_id === user?.id
                                );
                                const isSelected = userReaction?.reaction_type === emoji;
                                return (
                                  <Button
                                    key={emoji}
                                    variant="ghost"
                                    size="sm"
                                    className={`h-8 w-8 p-0 ${isSelected ? 'bg-primary/20 ring-2 ring-primary' : ''}`}
                                    onClick={() => toggleReactionMutation.mutate({ 
                                      messageId: msg.id, 
                                      reactionType: emoji
                                    })}
                                  >
                                    {emoji}
                                  </Button>
                                );
                              })}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                    
                    {/* Actions dropdown */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onClick={() => handleReply(msg)}>
                          <Reply className="h-4 w-4 mr-2" />
                          Reply
                        </DropdownMenuItem>
                        {isOwnMessage && (
                          <DropdownMenuItem onClick={() => handleEdit(msg)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                        )}
                        {(isOwnMessage || isAdmin) && (
                          <DropdownMenuItem 
                            onClick={() => deleteMessageMutation.mutate(msg.id)}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            );
          })}
              <div ref={messagesEndRef} />
            </div>
          </div>
        )}
      </div>

      {/* Input - Fixed at bottom above nav bar */}
      <div className="fixed left-0 right-0 bg-background z-[49]" style={{ bottom: 0, height: `calc(4rem + ${bottomInset} + 3rem)` }} />
      <div className="fixed left-0 right-0 border-t pt-1 pb-2 px-4 bg-background z-[51]" style={{ bottom: `calc(4rem + ${bottomInset})` }}>
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
        <div className="flex items-center gap-2">
          <ChatImageInput 
            onImageUploaded={setImageUrl} 
            imageUrl={imageUrl} 
            clubId={group?.club_id || undefined}
            teamId={group?.team_id || undefined}
          />
          <MentionInput
            value={message}
            onChange={(val) => {
              setMessage(val);
              if (val.trim()) startTyping();
              else stopTyping();
            }}
            placeholder="Type a message... (@ to mention)"
            onKeyPress={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                stopTyping();
                handleSend();
              }
            }}
            groupId={groupId}
            teamId={group?.team_id || undefined}
            clubId={group?.club_id || undefined}
            disabled={sendMessageMutation.isPending}
            showEmojiPicker={false}
          />
          <Button 
            onClick={() => {
              stopTyping();
              handleSend();
            }} 
            disabled={!message.trim() && !imageUrl}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
