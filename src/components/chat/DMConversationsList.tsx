import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronRight, Crown, MessageCircle, ImageIcon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

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
}: { 
  text?: string; 
  imageUrl?: string | null;
  isOwn: boolean;
}) => {
  const hasText = text && text.trim();
  const isImageOnly = !hasText && imageUrl;
  const hasTextAndImage = hasText && imageUrl;
  
  return (
    <span className="flex items-center gap-1.5">
      {isOwn && <span className="text-muted-foreground">You:</span>}
      {isImageOnly && imageUrl && (
        <img 
          src={imageUrl} 
          alt="" 
          className="h-5 w-5 rounded object-cover shrink-0"
        />
      )}
      {hasTextAndImage && (
        <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate">{hasText ? text : (isImageOnly ? "Image" : "Start a conversation")}</span>
    </span>
  );
};

interface DMConversationsListProps {
  searchQuery?: string;
}

export function DMConversationsList({ searchQuery = "" }: DMConversationsListProps) {
  const { user } = useAuth();

  // Fetch DM conversations with last message
  const { data: conversations, isLoading } = useQuery({
    queryKey: ["dm-conversations", user?.id],
    queryFn: async () => {
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

      return convos.map(conv => {
        const otherUserId = conv.participant_1 === user!.id ? conv.participant_2 : conv.participant_1;
        return {
          ...conv,
          other_user: profileMap.get(otherUserId) || null,
          last_message: messageMap.get(conv.id) || null,
        };
      }) as DMConversation[];
    },
    enabled: !!user,
    staleTime: 30000,
  });

  // Filter by search query
  const filteredConversations = conversations?.filter(conv => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return conv.other_user?.display_name?.toLowerCase().includes(query);
  }) || [];

  if (isLoading) {
    return (
      <>
        <DMSkeleton />
        <DMSkeleton />
      </>
    );
  }

  if (filteredConversations.length === 0) {
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
    <>
      {/* Section header */}
      <div className="flex items-center gap-2 pt-2 pb-1">
        <span className="text-sm font-medium text-muted-foreground">Direct Messages</span>
        <Badge variant="secondary" className="gap-1 text-xs">
          <Crown className="h-3 w-3" />
          Pro
        </Badge>
      </div>

      {filteredConversations.map((conv) => {
        const isOwn = conv.last_message?.author_id === user?.id;
        
        return (
          <Link key={conv.id} to={`/messages/dm/${conv.id}`}>
            <Card className="hover:border-primary/50 transition-colors">
              <CardContent className="p-4 flex items-center gap-4">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={conv.other_user?.avatar_url || undefined} />
                  <AvatarFallback className="bg-secondary text-secondary-foreground">
                    {conv.other_user?.display_name?.charAt(0).toUpperCase() || "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <h3 className="truncate font-semibold">
                    {conv.other_user?.display_name || "Unknown User"}
                  </h3>
                  <p className="text-sm text-muted-foreground truncate">
                    <MessagePreview 
                      text={conv.last_message?.text} 
                      imageUrl={conv.last_message?.image_url}
                      isOwn={isOwn}
                    />
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {conv.last_message?.created_at && (
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(conv.last_message.created_at), { addSuffix: true })}
                    </span>
                  )}
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </>
  );
}
