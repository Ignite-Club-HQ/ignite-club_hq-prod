import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronRight, Crown, MessageCircle, ImageIcon, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useMemo } from "react";
import { getCachedMessagesPageData, cacheMessagesPageData } from "@/lib/messagesPageCache";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

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
  const queryClient = useQueryClient();

  // Delete conversation mutation
  const deleteConversationMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      // First delete all messages in the conversation
      const { error: messagesError } = await supabase
        .from("direct_messages")
        .delete()
        .eq("conversation_id", conversationId);
      
      if (messagesError) throw messagesError;
      
      // Then delete the conversation itself
      const { error: convError } = await supabase
        .from("direct_conversations")
        .delete()
        .eq("id", conversationId);
      
      if (convError) throw convError;
    },
    onSuccess: () => {
      toast.success("Conversation deleted");
      queryClient.invalidateQueries({ queryKey: ["dm-conversations"] });
    },
    onError: (error) => {
      toast.error("Failed to delete conversation");
      console.error("Delete conversation error:", error);
    },
  });

  // Load cached data for instant display
  const cachedData = useMemo(() => {
    if (!user?.id) return null;
    return getCachedMessagesPageData(user.id);
  }, [user?.id]);

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

      const result = convos.map(conv => {
        const otherUserId = conv.participant_1 === user!.id ? conv.participant_2 : conv.participant_1;
        return {
          ...conv,
          other_user: profileMap.get(otherUserId) || null,
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
    <div className="space-y-2 border-t pt-4 mt-4">
      {/* Section header */}
      <div className="flex items-center gap-2 pb-1">
        <span className="text-sm font-medium text-muted-foreground">Direct Messages</span>
        <Badge variant="secondary" className="gap-1 text-xs">
          <Crown className="h-3 w-3" />
          Pro
        </Badge>
      </div>

      {filteredConversations.map((conv) => {
        const isOwn = conv.last_message?.author_id === user?.id;
        
        return (
          <div key={conv.id} className="relative group">
            <Link to={`/messages/dm/${conv.id}`}>
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
            
            {/* Delete button */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 hover:bg-destructive hover:text-destructive-foreground"
                  onClick={(e) => e.preventDefault()}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all messages with {conv.other_user?.display_name || "this user"}. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteConversationMutation.mutate(conv.id)}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        );
      })}
    </div>
  );
}
