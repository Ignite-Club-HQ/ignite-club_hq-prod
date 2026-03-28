import { useState, useRef, useEffect, useCallback, memo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreVertical, Pencil, Trash2, X, Check, Reply, Clock, ShieldAlert, Flag } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmojiPicker } from "./EmojiPicker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { removeMessageFromCache } from "@/lib/messageCache";
import { MessageContent } from "./MessageContent";
import { MessageReactionsPopover, MessageReactionsDisplay } from "./MessageReactions";
import { ReplyIndicator } from "./ReplyPreview";
import { MessageReadAvatars } from "./MessageReadAvatars";
import { MessageReadIndicator } from "./MessageReadIndicator";
import type { ReaderInfo } from "@/hooks/useMessageReads";
import { toast } from "sonner";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import { useBlockedUsers } from "@/hooks/useBlockedUsers";
import { ReportMessageDialog } from "@/components/chat/ReportMessageDialog";

interface Reaction {
  id: string;
  user_id: string;
  reaction_type: string;
}

interface ReplyToMessage {
  text: string;
  authorName: string | null;
}

export interface ChatMessageProps {
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
  messageType: "team" | "club" | "broadcast" | "group" | "dm";
  queryKey: string[];
  replyToMessage?: ReplyToMessage | null;
  onReply?: (message: { id: string; text: string; authorName: string | null }) => void;
  searchQuery?: string;
  readFrontierReaders?: ReaderInfo[];
  readCount?: number;
  readerName?: string | null;
  isLastMessage?: boolean;
  isPending?: boolean;
  isSystemMessage?: boolean;
  contextId?: string;
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
  readFrontierReaders = [],
  readCount = 0,
  readerName,
  isLastMessage = false,
  isPending = false,
  isSystemMessage = false,
  contextId,
}: ChatMessageProps) {
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(text);
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [showReadReceipts, setShowReadReceipts] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const queryClient = useQueryClient();
  const { isBlocked } = useBlockedUsers();


  const getMessageIdField = () => {
    switch (messageType) {
      case "team": return "team_message_id";
      case "club": return "club_message_id";
      case "broadcast": return "broadcast_message_id";
      case "group": return "group_message_id";
      case "dm": return "direct_message_id";
    }
  };

  const getTableName = () => {
    switch (messageType) {
      case "team": return "team_messages";
      case "club": return "club_messages";
      case "broadcast": return "broadcast_messages";
      case "group": return "group_messages";
      case "dm": return "direct_messages";
    }
  };
  
  const canDelete = isOwn || isAdmin;
  const isPendingMessage = id.startsWith("temp-") || id.startsWith("queued-");
  const canReply = !!onReply && !isPendingMessage;

  const updateReactionMessages = useCallback((updater: (messages: any[]) => any[]) => {
    queryClient.setQueryData(queryKey, (old: any) => {
      const existingMessages: any[] = Array.isArray(old)
        ? old
        : old?.messages || [];

      const updatedMessages = updater(existingMessages);

      if (Array.isArray(old) || old === undefined) {
        return updatedMessages;
      }

      return {
        ...old,
        messages: updatedMessages,
      };
    });
  }, [queryClient, queryKey]);

  const addReactionMutation = useMutation({
    mutationFn: async ({ reactionType }: { reactionType: string; existingReactionId?: string }) => {
      const messageIdField = getMessageIdField();

      if (!currentUserId) {
        throw new Error("Not authenticated");
      }

      const { data: existingReaction, error: fetchError } = await supabase
        .from("message_reactions")
        .select("id, user_id, reaction_type")
        .eq(messageIdField, id)
        .eq("user_id", currentUserId)
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (existingReaction) {
        if (existingReaction.reaction_type === reactionType) {
          const { error } = await supabase
            .from("message_reactions")
            .delete()
            .eq("id", existingReaction.id);

          if (error) throw error;

          return { action: "delete" as const, reactionId: existingReaction.id };
        }

        const { data: updatedReaction, error } = await supabase
          .from("message_reactions")
          .update({ reaction_type: reactionType })
          .eq("id", existingReaction.id)
          .select("id, user_id, reaction_type")
          .single();

        if (error) throw error;

        return { action: "update" as const, reaction: updatedReaction };
      }

      const { data: insertedReaction, error } = await supabase
        .from("message_reactions")
        .insert({
          [messageIdField]: id,
          user_id: currentUserId,
          reaction_type: reactionType,
        })
        .select("id, user_id, reaction_type")
        .single();

      if (error) throw error;

      return { action: "insert" as const, reaction: insertedReaction };
    },
    onMutate: async ({ reactionType }) => {
      await queryClient.cancelQueries({ queryKey });
      const previousMessages = queryClient.getQueryData(queryKey);

      if (!currentUserId) {
        return { previousMessages, tempReactionId: null };
      }

      const existingUserReaction = reactions.find((reaction) => reaction.user_id === currentUserId);
      const shouldRemoveReaction = existingUserReaction?.reaction_type === reactionType;
      const tempReactionId = shouldRemoveReaction ? null : `temp-${Date.now()}`;

      updateReactionMessages((msgs) =>
        msgs.map((msg: any) => {
          if (msg.id !== id) return msg;

          const filteredReactions = (msg.reactions || []).filter(
            (reaction: any) => reaction.user_id !== currentUserId
          );

          return {
            ...msg,
            reactions: shouldRemoveReaction || !tempReactionId
              ? filteredReactions
              : [
                  ...filteredReactions,
                  { id: tempReactionId, user_id: currentUserId, reaction_type: reactionType },
                ],
          };
        })
      );

      return { previousMessages, tempReactionId };
    },
    onSuccess: (result) => {
      if (!result) return;

      updateReactionMessages((msgs) =>
        msgs.map((msg: any) => {
          if (msg.id !== id) return msg;

          if (result.action === "delete") {
            return {
              ...msg,
              reactions: (msg.reactions || []).filter((reaction: any) => reaction.id !== result.reactionId),
            };
          }

          return {
            ...msg,
            reactions: [
              ...(msg.reactions || []).filter((reaction: any) => reaction.user_id !== result.reaction.user_id),
              result.reaction,
            ],
          };
        })
      );
    },
    onError: (err, variables, context) => {
      console.error("[Reaction] Mutation error:", err);
      if (context?.previousMessages) {
        queryClient.setQueryData(queryKey, context.previousMessages);
      }
      toast.error("Failed to add reaction");
    },
  });

  const removeReactionMutation = useMutation({
    mutationFn: async (reactionId: string) => {
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

      updateReactionMessages((msgs) =>
        msgs.map((msg: any) => {
          if (msg.id !== id) return msg;
          return {
            ...msg,
            reactions: (msg.reactions || []).filter((reaction: any) => reaction.id !== reactionId),
          };
        })
      );

      return { previousMessages };
    },
    onError: (err, variables, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(queryKey, context.previousMessages);
      }
    },
    onSettled: () => {
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
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey });
      const previousMessages = queryClient.getQueryData(queryKey);
      
      queryClient.setQueryData(queryKey, (old: any) => {
        if (!old) return old;
        const existingMessages: any[] = Array.isArray(old) ? old : old?.messages || [];
        const updatedMessages = existingMessages.filter((msg: any) => msg.id !== id);
        if (Array.isArray(old)) return updatedMessages;
        return { ...old, messages: updatedMessages };
      });
      
      return { previousMessages };
    },
    onSuccess: () => {
      const targetId = queryKey[1] as string;
      if (targetId) {
        removeMessageFromCache(messageType, targetId, id);
      }
      try {
        localStorage.removeItem('messages-page-cache');
      } catch {}
      // Silent success - no toast
    },
    onError: (err, variables, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(queryKey, context.previousMessages);
      }
      toast.error("Failed to delete message");
    },
  });

  const handleLongPressStart = useCallback((e: React.TouchEvent) => {
    touchStartPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    longPressTimer.current = setTimeout(() => {
      setShowMenu(true);
      setShowReactionPicker(true);
    }, 600);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (longPressTimer.current && touchStartPos.current) {
      const dx = e.touches[0].clientX - touchStartPos.current.x;
      const dy = e.touches[0].clientY - touchStartPos.current.y;
      // Cancel long press if finger moved more than 10px (scrolling)
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
        touchStartPos.current = null;
      }
    }
  }, []);

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    touchStartPos.current = null;
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
    setShowMenu(true);
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

  const handleMenuOpenChange = useCallback((open: boolean) => {
    setIsDropdownOpen(open);
    if (!open && !showReactionPicker) {
      setShowMenu(false);
    }
  }, [showReactionPicker]);

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

  // Close three-dot menu when tapping outside
  useEffect(() => {
    if (!showMenu || isDropdownOpen) return;
    
    const handleClickOutside = () => {
      setShowMenu(false);
    };
    
    const timer = setTimeout(() => {
      document.addEventListener('touchstart', handleClickOutside);
      document.addEventListener('click', handleClickOutside);
    }, 0);
    
    return () => {
      clearTimeout(timer);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showMenu, isDropdownOpen]);

  // Get display name - never show placeholder text; hide name until profile loads
  const displayName = authorName || "";
  const hasName = !!authorName;

  // Handle inserting emoji at cursor position
  const inputRef = useRef<HTMLInputElement>(null);
  
  const handleEditEmojiSelect = useCallback((emoji: string) => {
    const input = inputRef.current;
    if (input) {
      const start = input.selectionStart || editText.length;
      const end = input.selectionEnd || editText.length;
      const newText = editText.slice(0, start) + emoji + editText.slice(end);
      setEditText(newText);
      // Set cursor position after emoji
      requestAnimationFrame(() => {
        input.focus();
        input.setSelectionRange(start + emoji.length, start + emoji.length);
      });
    } else {
      setEditText(prev => prev + emoji);
    }
  }, [editText]);

  // Hide messages from blocked users (after all hooks)
  if (!isOwn && isBlocked(authorId)) return null;

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
          <div className="flex items-center gap-1">
            <Input
              ref={inputRef}
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
            <EmojiPicker onEmojiSelect={handleEditEmojiSelect} />
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
      <div className={`flex flex-col max-w-[75%] ${isOwn ? "items-end" : "items-start"}`}>
        {!isOwn && hasName && (
          <p className="text-xs text-muted-foreground mb-1">{displayName}</p>
        )}
        <ReplyIndicator replyToMessage={replyToMessage} isOwn={isOwn} />
        <div className="flex items-start gap-1">
          {isOwn && showMenu && (
            <DropdownMenu open={isDropdownOpen} onOpenChange={handleMenuOpenChange}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 min-h-[32px] min-w-[32px]"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsDropdownOpen(true);
                  }}
                  onTouchStart={(e) => e.stopPropagation()}
                  onTouchEnd={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" collisionPadding={16} className="bg-popover border">
                {canReply && (
                  <DropdownMenuItem onClick={handleReply}>
                    <Reply className="h-4 w-4 mr-2" /> Reply
                  </DropdownMenuItem>
                )}
                {!imageUrl && (
                  <DropdownMenuItem onClick={handleStartEdit}>
                    <Pencil className="h-4 w-4 mr-2" /> Edit
                  </DropdownMenuItem>
                )}
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
            onTouchStart={handleLongPressStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleLongPressEnd}
            onContextMenu={handleContextMenu}
          >
            <div className="text-sm">
              <MessageContent 
                text={text} 
                imageUrl={imageUrl} 
                searchQuery={searchQuery} 
                showPreviews={false}
                showImageActions={!isOwn && !isSystemMessage && !!imageUrl}
                onReportImage={() => setShowReportDialog(true)}
                onBlockImageAuthor={() => setShowBlockDialog(true)}
              />
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
          {!isOwn && showMenu && (
            <DropdownMenu open={isDropdownOpen} onOpenChange={handleMenuOpenChange}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 min-h-[32px] min-w-[32px]"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsDropdownOpen(true);
                  }}
                  onTouchStart={(e) => e.stopPropagation()}
                  onTouchEnd={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" collisionPadding={16} className="bg-popover border">
                {canReply && (
                  <DropdownMenuItem onClick={handleReply}>
                    <Reply className="h-4 w-4 mr-2" /> Reply
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <DropdownMenuItem 
                    onClick={handleDelete}
                    className="text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" /> Delete
                  </DropdownMenuItem>
                )}
                {!isOwn && !isSystemMessage && (
                  <DropdownMenuItem 
                    onClick={() => setShowReportDialog(true)}
                  >
                    <Flag className="h-4 w-4 mr-2" /> Report Message
                  </DropdownMenuItem>
                )}
                {!isOwn && !isSystemMessage && (
                  <DropdownMenuItem 
                    onClick={() => setShowBlockDialog(true)}
                    className="text-destructive"
                  >
                    <ShieldAlert className="h-4 w-4 mr-2" /> Block User
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
          {!isPending && !isLastMessage && <MessageReadIndicator readCount={readCount} isOwn={isOwn} readerName={readerName} />}
        </p>
        {!isPending && isLastMessage && isOwn && (
          readFrontierReaders.length > 0
            ? <MessageReadAvatars readers={readFrontierReaders} isOwn={isOwn} />
            : <p className={`text-[10px] text-muted-foreground mt-0.5 ${isOwn ? "text-right" : ""}`}>Sent</p>
        )}
      </div>
      {showBlockDialog && (
        <BlockUserDialog
          open={showBlockDialog}
          onOpenChange={setShowBlockDialog}
          userId={authorId}
          userName={authorName || "this user"}
        />
      )}
      {showReportDialog && (
        <ReportMessageDialog
          isOpen={showReportDialog}
          onClose={() => setShowReportDialog(false)}
          messageId={id}
          messageType={messageType === "dm" ? "direct" : messageType}
        />
      )}
    </div>
  );
});