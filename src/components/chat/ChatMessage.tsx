import { useState, useRef, useEffect, useCallback, memo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreVertical, Pencil, Trash2, X, Check, Reply, Clock } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { MessageContent } from "./MessageContent";
import { MessageReactionsPopover, MessageReactionsDisplay } from "./MessageReactions";
import { ReplyIndicator } from "./ReplyPreview";
import { MessageReadIndicator } from "./MessageReadIndicator";
import { toast } from "sonner";

interface Reaction {
  id: string;
  user_id: string;
  reaction_type: string;
}

interface ReplyToMessage {
  text: string;
  authorName: string | null;
}

interface ChatMessageProps {
  id: string;
  text: string;
  imageUrl?: string | null;
  authorId: string;
  authorName?: string | null;
  authorAvatar?: string | null;
  timestamp: string;
  isOwn: boolean;
  isAdmin?: boolean;
  reactions?: Reaction[];
  currentUserId?: string;
  messageType: "team" | "club" | "broadcast" | "group";
  queryKey: string[];
  replyToMessage?: ReplyToMessage | null;
  onReply?: (message: { id: string; text: string; authorName: string | null }) => void;
  searchQuery?: string;
  readCount?: number;
  isPending?: boolean;
}

export const ChatMessage = memo(function ChatMessage({
  id,
  text,
  imageUrl,
  authorId,
  authorName,
  authorAvatar,
  timestamp,
  isOwn,
  isAdmin = false,
  reactions = [],
  currentUserId,
  messageType,
  queryKey,
  replyToMessage,
  onReply,
  searchQuery,
  readCount = 0,
  isPending = false,
}: ChatMessageProps) {
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(text);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const queryClient = useQueryClient();

  const getMessageIdField = () => {
    switch (messageType) {
      case "team": return "team_message_id";
      case "club": return "club_message_id";
      case "broadcast": return "broadcast_message_id";
      case "group": return "group_message_id";
    }
  };

  const getTableName = () => {
    switch (messageType) {
      case "team": return "team_messages";
      case "club": return "club_messages";
      case "broadcast": return "broadcast_messages";
      case "group": return "group_messages";
    }
  };
  
  const canDelete = isOwn || isAdmin;
  const isPendingMessage = id.startsWith("temp-") || id.startsWith("queued-");
  const canReply = !!onReply && !isPendingMessage;

  const addReactionMutation = useMutation({
    mutationFn: async ({ reactionType, existingReactionId }: { reactionType: string; existingReactionId?: string }) => {
      // First, remove any existing reaction from this user on this message
      if (existingReactionId && !existingReactionId.startsWith("temp-")) {
        await supabase
          .from("message_reactions")
          .delete()
          .eq("id", existingReactionId);
      }
      
      // Then add the new reaction
      const { error } = await supabase.from("message_reactions").insert({
        [getMessageIdField()]: id,
        user_id: currentUserId!,
        reaction_type: reactionType,
      });
      if (error) throw error;
    },
    onMutate: async ({ reactionType }) => {
      await queryClient.cancelQueries({ queryKey });
      const previousMessages = queryClient.getQueryData(queryKey);

      const updateMessages = (updater: (messages: any[]) => any[]) => {
        queryClient.setQueryData(queryKey, (old: any) => {
          const existingMessages: any[] = Array.isArray(old)
            ? old
            : old?.messages || [];

          const newMessages = updater(existingMessages);

          if (Array.isArray(old) || old === undefined) {
            return newMessages;
          }

          return {
            ...old,
            messages: newMessages,
          };
        });
      };

      // Optimistically update - remove old reaction, add new one
      updateMessages((msgs) =>
        msgs.map((msg: any) => {
          if (msg.id === id) {
            const filteredReactions = (msg.reactions || []).filter(
              (r: any) => r.user_id !== currentUserId
            );
            return {
              ...msg,
              reactions: [
                ...filteredReactions,
                { id: `temp-${Date.now()}`, user_id: currentUserId, reaction_type: reactionType },
              ],
            };
          }
          return msg;
        })
      );

      return { previousMessages };
    },
      
    onError: (err, variables, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(queryKey, context.previousMessages);
      }
      toast.error("Failed to add reaction");
    },
    // Don't invalidate - optimistic update is sufficient, realtime handles sync
  });

  const removeReactionMutation = useMutation({
    mutationFn: async (reactionId: string) => {
      // Skip deletion for temp IDs (optimistic reactions not yet persisted)
      if (reactionId.startsWith("temp-")) {
        return;
      }
      const { error } = await supabase
        .from("message_reactions")
        .delete()
        .eq("id", reactionId);
      if (error) throw error;
    },
    onMutate: async (reactionId: string) => {
      await queryClient.cancelQueries({ queryKey });
      const previousMessages = queryClient.getQueryData(queryKey);
      
      // Optimistically remove the reaction - handle both array and object cache shapes
      queryClient.setQueryData(queryKey, (old: any) => {
        if (!old) return old;
        
        const existingMessages: any[] = Array.isArray(old)
          ? old
          : old?.messages || [];
        
        const updatedMessages = existingMessages.map((msg: any) => {
          if (msg.id === id) {
            return {
              ...msg,
              reactions: (msg.reactions || []).filter((r: any) => r.id !== reactionId)
            };
          }
          return msg;
        });
        
        // Preserve the original cache shape
        if (Array.isArray(old)) {
          return updatedMessages;
        }
        return { ...old, messages: updatedMessages };
      });
      
      return { previousMessages };
    },
    onError: (err, variables, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(queryKey, context.previousMessages);
      }
    },
    onSettled: () => {
      // Don't invalidate - optimistic update is sufficient
    },
  });

  const editMessageMutation = useMutation({
    mutationFn: async (newText: string) => {
      const { error } = await supabase
        .from(getTableName())
        .update({ text: newText })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setIsEditing(false);
      toast.success("Message updated");
    },
    onError: () => {
      toast.error("Failed to update message");
    },
  });

  const deleteMessageMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from(getTableName())
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Message deleted");
    },
    onError: () => {
      toast.error("Failed to delete message");
    },
  });

  const handleLongPressStart = useCallback(() => {
    longPressTimer.current = setTimeout(() => {
      setShowReactionPicker(true);
    }, 500);
  }, []);

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleReactionClick = useCallback((type: string, existingReactionId?: string) => {
    if (existingReactionId) {
      removeReactionMutation.mutate(existingReactionId);
    } else {
      // Find existing reaction at call time to avoid stale closure
      const existingReaction = reactions.find(r => r.user_id === currentUserId);
      addReactionMutation.mutate({ 
        reactionType: type, 
        existingReactionId: existingReaction?.id 
      });
    }
  }, [addReactionMutation, removeReactionMutation, reactions, currentUserId]);

  const handleSaveEdit = useCallback(() => {
    if (editText.trim() && editText !== text) {
      editMessageMutation.mutate(editText.trim());
    } else {
      setIsEditing(false);
      setEditText(text);
    }
  }, [editText, text, editMessageMutation]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditText(text);
  }, [text]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setShowReactionPicker(true);
  }, []);

  const handleReply = useCallback(() => {
    onReply?.({ id, text, authorName: authorName || null });
  }, [onReply, id, text, authorName]);

  const handleStartEdit = useCallback(() => {
    setIsEditing(true);
  }, []);

  const handleDelete = useCallback(() => {
    deleteMessageMutation.mutate();
  }, [deleteMessageMutation]);

  const handleShowReactions = useCallback(() => {
    setShowReactionPicker(true);
  }, []);

  useEffect(() => {
    return () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
      }
    };
  }, []);

  // Close reaction picker when clicking outside
  useEffect(() => {
    if (!showReactionPicker) return;
    
    const handleClickOutside = () => {
      setShowReactionPicker(false);
    };
    
    // Use setTimeout to avoid immediately closing from the same click that opened it
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);
    
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showReactionPicker]);

  // Generate a consistent placeholder name based on author ID when profile not loaded
  const getPlaceholderName = (id: string): string => {
    const firstNames = ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Quinn", "Avery", "Parker", "Drew"];
    const lastNames = ["Smith", "Johnson", "Brown", "Davis", "Wilson", "Moore", "Clark", "Lewis", "Walker", "Hall"];
    
    // Use the ID to generate consistent indices
    const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const firstName = firstNames[hash % firstNames.length];
    const lastName = lastNames[(hash * 7) % lastNames.length];
    return `${firstName} ${lastName}`;
  };

  // Get display name - fallback to generated name if profile not loaded
  const displayName = authorName || getPlaceholderName(authorId);
  const hasName = !!authorName;

  if (isEditing) {
    return (
      <div className={`flex gap-3 ${isOwn ? "flex-row-reverse" : ""}`}>
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarImage src={authorAvatar || undefined} />
          <AvatarFallback className="text-xs">
            {displayName.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 max-w-[75%]">
          <div className="flex gap-2">
            <Input
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="flex-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveEdit();
                if (e.key === "Escape") {
                  setIsEditing(false);
                  setEditText(text);
                }
              }}
            />
            <Button size="icon" variant="ghost" onClick={handleSaveEdit}>
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={handleCancelEdit}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex gap-3 group ${isOwn ? "flex-row-reverse" : ""}`}>
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarImage src={authorAvatar || undefined} />
        <AvatarFallback className="text-xs">
          {displayName.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className={`max-w-[75%] ${isOwn ? "items-end" : "items-start"}`}>
        {!isOwn && (
          <p className="text-xs text-muted-foreground mb-1">{displayName}</p>
        )}
        <ReplyIndicator replyToMessage={replyToMessage} isOwn={isOwn} />
        <div className="flex items-start gap-1">
          {isOwn && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <MoreVertical className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-popover border">
                {canReply && (
                  <DropdownMenuItem onClick={handleReply}>
                    <Reply className="h-4 w-4 mr-2" /> Reply
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleStartEdit}>
                  <Pencil className="h-4 w-4 mr-2" /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={handleDelete}
                  className="text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <div
            className={`relative rounded-2xl px-4 py-2 select-none ${
              isOwn
                ? "bg-primary text-primary-foreground rounded-br-sm"
                : "bg-muted rounded-bl-sm"
            }`}
            onMouseDown={handleLongPressStart}
            onMouseUp={handleLongPressEnd}
            onMouseLeave={handleLongPressEnd}
            onTouchStart={handleLongPressStart}
            onTouchEnd={handleLongPressEnd}
            onContextMenu={handleContextMenu}
          >
            <div className="text-sm">
              <MessageContent text={text} imageUrl={imageUrl} searchQuery={searchQuery} showPreviews={false} />
            </div>
            <MessageReactionsPopover
              reactions={reactions}
              currentUserId={currentUserId}
              onReact={(type) => {
                const existingReaction = reactions.find(r => r.user_id === currentUserId);
                addReactionMutation.mutate({ reactionType: type, existingReactionId: existingReaction?.id });
              }}
              onRemove={(reactionId) => removeReactionMutation.mutate(reactionId)}
              isOpen={showReactionPicker}
              onOpenChange={setShowReactionPicker}
              isOwnMessage={isOwn}
            />
          </div>
          {!isOwn && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <MoreVertical className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="bg-popover border">
                {canReply && (
                  <DropdownMenuItem onClick={handleReply}>
                    <Reply className="h-4 w-4 mr-2" /> Reply
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleShowReactions}>
                  React
                </DropdownMenuItem>
                {canDelete && (
                  <DropdownMenuItem 
                    onClick={handleDelete}
                    className="text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" /> Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {/* Link previews rendered outside the message bubble */}
        <MessageContent text={text} previewsOnly />
        
        <MessageReactionsDisplay
          reactions={reactions}
          currentUserId={currentUserId}
          onReactionClick={handleReactionClick}
        />
        
        <p className={`text-[10px] text-muted-foreground mt-1 flex items-center gap-1 ${isOwn ? "justify-end" : ""}`}>
          {isPending && (
            <span className="flex items-center gap-0.5 text-amber-500" title="Pending sync">
              <Clock className="h-3 w-3" />
            </span>
          )}
          {timestamp}
          {!isPending && <MessageReadIndicator readCount={readCount} isOwn={isOwn} />}
        </p>
      </div>
    </div>
  );
});