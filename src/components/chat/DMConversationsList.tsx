import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronRight, Crown, MessageCircle, ImageIcon, Flame } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useMemo } from "react";
import { getCachedMessagesPageData, cacheMessagesPageData } from "@/lib/messagesPageCache";
import { toast } from "sonner";
import { isIgniteSupportUser } from "@/lib/systemUser";
import { ensureFreshSession } from "@/lib/ensureFreshSession";
import { formatMessagePreview as stripMentionFormatting, extractEventIds } from "@/lib/messagePreview";
import { useIsUserOnline } from "@/hooks/useUserPresence";

interface DMConversation {
  id: string;
  participant_1: string;
  participant_2: string;
  updated_at: string;
  other_user: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  last_message: {
    text: string;
    image_url: string | null;
    created_at: string;
    author_id: string;
  } | null;
}

// Skeleton for loading state
function DMSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-4">
        <Skeleton className="h-12 w-12 rounded-full shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-5 w-5 rounded-full" />
        </div>
      </CardContent>
    </Card>
  );
}


// Message preview component
const MessagePreview = ({ 
  text, 
  imageUrl,
  isOwn,
  eventTitles,
}: { 
  text?: string; 
  imageUrl?: string | null;
  isOwn: boolean;
  eventTitles?: Record<string, string>;
}) => {
  const hasText = text && text.trim();
  const isImageOnly = !hasText && imageUrl;
  const hasTextAndImage = hasText && imageUrl;
  const displayText = hasText ? stripMentionFormatting(text!, eventTitles) : null;
  
  return (
    <span className="flex items-center gap-1.5">
      {isOwn && <span className="text-muted-foreground">You:</span>}
      {isImageOnly && (
        <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      {hasTextAndImage && (
        <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate">{displayText ?? (isImageOnly ? "Image" : "Start a conversation")}</span>
    </span>
  );
};

interface DMConversationsListProps {
  searchQuery?: string;
  hasProAccess?: boolean;
}

export function DMConversationsList({ searchQuery = "", hasProAccess = false }: DMConversationsListProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Fetch system messages (welcome message from Ignite Support)
  const { data: systemMessage } = useQuery({
    queryKey: ["system-messages", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_messages")
        .select("*")
        .eq("user_id", user!.id)
        .eq("message_type", "welcome")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) {
        console.error("Error fetching system messages:", error);
        return null;
      }
      return data;
    },
    enabled: !!user,
  });

  // Fetch hidden conversations
  const { data: hiddenConversationIds } = useQuery({
    queryKey: ["hidden-dm-conversations", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("hidden_dm_conversations")
        .select("conversation_id")
        .eq("user_id", user!.id);
      return new Set(data?.map(h => h.conversation_id) || []);
    },
    enabled: !!user,
  });

  // Hide conversation mutation
  const hideConversationMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase
        .from("hidden_dm_conversations")
        .insert({
          user_id: user!.id,
          conversation_id: conversationId,
        });
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Conversation hidden");
      queryClient.invalidateQueries({ queryKey: ["dm-conversations"] });
      queryClient.invalidateQueries({ queryKey: ["hidden-dm-conversations"] });
    },
    onError: (error) => {
      toast.error("Failed to hide conversation");
      console.error("Hide conversation error:", error);
    },
  });

  // Load cached data for instant display
  const cachedData = useMemo(() => {
    if (!user?.id) return null;
    return getCachedMessagesPageData(user.id);
  }, [user?.id]);

  // Fetch DM conversations with last message
  const { data: conversations, isLoading, isFetching } = useQuery({
    queryKey: ["dm-conversations", user?.id],
    queryFn: async () => {
      // Refresh the access token before reading. After phone lock/unlock the
      // JWT can be expired; an expired token makes RLS evaluate auth.uid()
      // as NULL and silently returns empty profile rows → "Unknown User".
      try {
        await ensureFreshSession();
      } catch {
        // Continue — query will throw if truly unauthenticated and React
        // Query will keep showing the previous data.
      }

      const { data: convos, error } = await supabase
        .from("direct_conversations")
        .select("*")
        .or(`participant_1.eq.${user!.id},participant_2.eq.${user!.id}`)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      if (!convos?.length) return [];

      // Get other user IDs
      const otherUserIds = convos.map(c => 
        c.participant_1 === user!.id ? c.participant_2 : c.participant_1
      );

      // Fetch profiles and last messages in parallel
      const [profilesResult, messagesResult] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", otherUserIds),
        Promise.all(
          convos.map(async (conv) => {
            const { data } = await supabase
              .from("direct_messages")
              .select("text, image_url, created_at, author_id")
              .eq("conversation_id", conv.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            return { conversationId: conv.id, message: data };
          })
        ),
      ]);

      const profileMap = new Map(
        profilesResult.data?.map(p => [p.id, p]) || []
      );
      const messageMap = new Map(
        messagesResult.map(m => [m.conversationId, m.message])
      );

      // Build a fallback map of previously-known good profiles so a transient
      // empty profile fetch never downgrades a real name back to "Unknown User".
      const previousResult = queryClient.getQueryData<DMConversation[]>(["dm-conversations", user?.id]);
      const previousOtherUserMap = new Map<string, DMConversation["other_user"]>();
      previousResult?.forEach((c) => {
        if (c?.other_user?.id && c.other_user.display_name) {
          previousOtherUserMap.set(c.other_user.id, c.other_user);
        }
      });
      cachedData?.dmConversations?.forEach((c: any) => {
        if (c?.other_user?.id && c.other_user.display_name && !previousOtherUserMap.has(c.other_user.id)) {
          previousOtherUserMap.set(c.other_user.id, c.other_user);
        }
      });

      const result = convos.map(conv => {
        const otherUserId = conv.participant_1 === user!.id ? conv.participant_2 : conv.participant_1;
        const fetched = profileMap.get(otherUserId);
        const fallback = previousOtherUserMap.get(otherUserId);
        const otherUser: DMConversation["other_user"] = fetched
          ? {
              id: otherUserId,
              display_name: fetched.display_name || fallback?.display_name || null,
              avatar_url: fetched.avatar_url ?? fallback?.avatar_url ?? null,
            }
          : fallback || null;
        return {
          ...conv,
          other_user: otherUser,
          last_message: messageMap.get(conv.id) || null,
        };
      }) as DMConversation[];

      // Cache the conversations and latest messages
      const dmConversationsForCache = result.map(conv => ({
        id: conv.id,
        participant_1: conv.participant_1,
        participant_2: conv.participant_2,
        updated_at: conv.updated_at,
        other_user: conv.other_user,
      }));
      
      const latestDMMessages: Record<string, { text: string; author: string; created_at: string; image_url?: string | null }> = {};
      result.forEach(conv => {
        if (conv.last_message) {
          latestDMMessages[conv.id] = {
            text: conv.last_message.text,
            author: conv.last_message.author_id === user!.id ? "You" : (conv.other_user?.display_name || ""),
            created_at: conv.last_message.created_at,
            image_url: conv.last_message.image_url,
          };
        }
      });
      
      cacheMessagesPageData(user!.id, { dmConversations: dmConversationsForCache, latestDMMessages });

      return result;
    },
    enabled: !!user,
    staleTime: 30000,
    placeholderData: () => {
      // Return cached conversations as placeholder
      if (!cachedData?.dmConversations?.length) return undefined;
      return cachedData.dmConversations.map(conv => ({
        ...conv,
        last_message: cachedData.latestDMMessages?.[conv.id] ? {
          text: cachedData.latestDMMessages[conv.id].text,
          image_url: cachedData.latestDMMessages[conv.id].image_url || null,
          created_at: cachedData.latestDMMessages[conv.id].created_at,
          author_id: cachedData.latestDMMessages[conv.id].author === "You" ? user?.id || "" : conv.other_user?.id || "",
        } : null,
      })) as DMConversation[];
    },
  });

  // Filter by search query and exclude hidden conversations
  const filteredConversations = conversations?.filter(conv => {
    // Exclude hidden conversations
    if (hiddenConversationIds?.has(conv.id)) return false;
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return conv.other_user?.display_name?.toLowerCase().includes(query);
  }) || [];

  // Resolve event titles referenced in any DM preview
  const referencedEventIds = useMemo(() => {
    const set = new Set<string>();
    filteredConversations.forEach((c) => {
      extractEventIds(c.last_message?.text).forEach((id) => set.add(id));
    });
    return Array.from(set);
  }, [filteredConversations]);

  const { data: eventTitleMap = {} } = useQuery({
    queryKey: ["dm-list-event-titles", referencedEventIds.join(",")],
    queryFn: async () => {
      if (referencedEventIds.length === 0) return {} as Record<string, string>;
      const { data } = await supabase
        .from("events")
        .select("id, title")
        .in("id", referencedEventIds);
      const map: Record<string, string> = {};
      (data || []).forEach((e) => {
        if (e?.id && e?.title) map[e.id.toLowerCase()] = e.title;
      });
      return map;
    },
    enabled: referencedEventIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <>
        <DMSkeleton />
        <DMSkeleton />
      </>
    );
  }

  // Check if "ignite support" matches search query
  const showIgniteSupport = systemMessage && (
    !searchQuery.trim() || "ignite support".includes(searchQuery.toLowerCase())
  );

  if (filteredConversations.length === 0 && !showIgniteSupport) {
    if (searchQuery) return null; // Don't show empty state when searching
    
    return (
      <Card className="border-dashed">
        <CardContent className="p-6 text-center">
          <MessageCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">No direct messages yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Start a conversation with a club member
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2 border-t pt-4 mt-4">
      {/* Section header */}
      <div className="flex items-center gap-2 pb-1">
        <span className="text-sm font-medium text-muted-foreground">Direct Messages</span>
        {!hasProAccess && (
          <Badge variant="secondary" className="gap-1 text-xs">
            <Crown className="h-3 w-3" />
            Pro
          </Badge>
        )}
      </div>

      {/* Ignite Support welcome message */}
      {showIgniteSupport && (
        <Card className="hover:border-primary/50 transition-colors cursor-pointer">
          <Link to="/messages/welcome">
            <CardContent className="py-[18px] px-3 flex items-center gap-3">
              <div className="h-9 w-9 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'hsl(142, 71%, 45%)' }}>
                <Flame className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-1">
                  <h3 className="truncate text-[15px] leading-tight font-semibold">Ignite Support</h3>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(systemMessage.created_at), { addSuffix: true })}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  </div>
                </div>
                <p className="text-[0.8125rem] leading-relaxed mt-1 line-clamp-2 text-foreground/70">
                  {systemMessage.text.substring(0, 60)}...
                </p>
              </div>
            </CardContent>
          </Link>
        </Card>
      )}

      {filteredConversations.map((conv) => (
        <DMConversationRow
          key={conv.id}
          conv={conv}
          currentUserId={user?.id}
          isFetching={isFetching}
          eventTitles={eventTitleMap}
        />
      ))}
    </div>
  );
}

interface DMConversationRowProps {
  conv: DMConversation;
  currentUserId: string | undefined;
  isFetching: boolean;
  eventTitles?: Record<string, string>;
}

function DMConversationRow({ conv, currentUserId, isFetching, eventTitles }: DMConversationRowProps) {
  const isOwn = conv.last_message?.author_id === currentUserId;
  const isIgniteSupport = isIgniteSupportUser(conv.other_user?.id);
  const profileLoading = !conv.other_user?.display_name && isFetching;
  const displayName = isIgniteSupport
    ? "Ignite Support"
    : conv.other_user?.display_name || (profileLoading ? null : "Unknown User");

  // Live presence — only meaningful for real users (not Ignite Support).
  const isOnline = useIsUserOnline(isIgniteSupport ? null : conv.other_user?.id);

  return (
    <Card className="hover:border-primary/50 transition-colors cursor-pointer">
      <Link to={`/messages/dm/${conv.id}`}>
        <CardContent className="py-[18px] px-3 flex items-center gap-3">
          <div className="relative shrink-0">
            {isIgniteSupport ? (
              <div
                className="h-9 w-9 rounded-full flex items-center justify-center"
                style={{ backgroundColor: "hsl(142, 71%, 45%)" }}
              >
                <Flame className="h-5 w-5 text-white" />
              </div>
            ) : (
              <Avatar className="h-9 w-9">
                <AvatarImage src={conv.other_user?.avatar_url || undefined} />
                <AvatarFallback className="bg-secondary text-secondary-foreground">
                  {conv.other_user?.display_name?.charAt(0).toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
            )}
            {isOnline && (
              <span
                aria-label="Online"
                className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-background"
                style={{ backgroundColor: "hsl(var(--success))" }}
              />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-1">
              {displayName ? (
                <h3 className="truncate text-[15px] leading-tight font-semibold">
                  {displayName}
                </h3>
              ) : (
                <Skeleton className="h-4 w-24" />
              )}
              <div className="flex items-center gap-0.5 shrink-0">
                {conv.last_message?.created_at && (
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(conv.last_message.created_at), {
                      addSuffix: true,
                    })}
                  </span>
                )}
                <ChevronRight
                  className="h-3.5 w-3.5 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
            </div>
            <p className="text-[0.8125rem] leading-relaxed mt-1 line-clamp-2 text-foreground/70">
              <MessagePreview
                text={conv.last_message?.text}
                imageUrl={conv.last_message?.image_url}
                isOwn={isOwn}
                eventTitles={eventTitles}
              />
            </p>
          </div>
        </CardContent>
      </Link>
    </Card>
  );
}
