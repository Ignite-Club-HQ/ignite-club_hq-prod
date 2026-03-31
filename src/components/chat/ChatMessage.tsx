import { useState, useRef, useEffect, useCallback, useLayoutEffect, memo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreVertical, Pencil, Trash2, X, Check, Reply, Clock, ShieldAlert, Flag, Megaphone } from "lucide-react";
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
import { createPortal } from "react-dom";
import { removeMessageFromCache } from "@/lib/messageCache";
import { MessageContent } from "./MessageContent";
import { MessageReactionsPopover, MessageReactionsDisplay } from "./MessageReactions";
import { ReplyIndicator } from "./ReplyPreview";
import { MessageReadAvatars } from "./MessageReadAvatars";
import { MessageReadIndicator } from "./MessageReadIndicator";
import { ReadReceiptSheet } from "./ReadReceiptSheet";
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
  messageType: "team" | "club" | "broadcast" | "group" | "dm" | "club_admin";
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
  isClubAnnouncement?: boolean;
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
  isClubAnnouncement = false,
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
  const bubbleRef = useRef<HTMLDivElement>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const suppressMenuUntilPointerUpRef = useRef(false);
  const ignoreReactionDismissRef = useRef(false);
  const menuClickGuardUntilRef = useRef(0);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const queryClient = useQueryClient();
  const { isBlocked } = useBlockedUsers();


  const getMessageIdField = () => {
    switch (messageType) {
      case "team": return "team_message_id";
      case "club": return "club_message_id";
      case "broadcast": return "broadcast_message_id";
      case "group": return "group_message_id";
      case "dm": return "direct_message_id";
      case "club_admin": return "club_admin_message_id";
    }
  };

  const getTableName = () => {
    switch (messageType) {
      case "team": return "team_messages";
      case "club": return "club_messages";
      case "broadcast": return "broadcast_messages";
      case "group": return "group_messages";
      case "dm": return "direct_messages";
      case "club_admin": return "club_admin_messages";
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

  const getLatestReactions = useCallback((): Reaction[] => {
    const cacheEntry = queryClient.getQueryData<any>(queryKey);
    const messages = Array.isArray(cacheEntry) ? cacheEntry : cacheEntry?.messages || [];
    const cachedMessage = messages.find((message: any) => message.id === id);
    return (cachedMessage?.reactions || reactions) as Reaction[];
  }, [queryClient, queryKey, id, reactions]);

  const addReactionMutation = useMutation({
    mutationFn: async ({
      reactionType,
      existingReaction,
    }: {
      reactionType: string;
      existingReaction?: Reaction;
    }) => {
      const messageIdField = getMessageIdField();

      if (!currentUserId) {
        throw new Error("Not authenticated");
      }

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

      if (error) {
        if ((error as { code?: string }).code === "23505") {
          const { data: conflictingReaction, error: conflictFetchError } = await supabase
            .from("message_reactions")
            .select("id")
            .eq(messageIdField, id)
            .eq("user_id", currentUserId)
            .maybeSingle();

          if (conflictFetchError || !conflictingReaction) {
            throw conflictFetchError || error;
          }

          const { data: updatedReaction, error: updateError } = await supabase
            .from("message_reactions")
            .update({ reaction_type: reactionType })
            .eq("id", conflictingReaction.id)
            .select("id, user_id, reaction_type")
            .single();

          if (updateError) throw updateError;

          return { action: "update" as const, reaction: updatedReaction };
        }

        throw error;
      }

      return { action: "insert" as const, reaction: insertedReaction };
    },
    onMutate: ({ reactionType, existingReaction }) => {
      // Don't block optimistic UI while waiting for query cancellation.
      // This keeps deselect/removal feeling instant.
      void queryClient.cancelQueries({ queryKey });
      const previousMessages = queryClient.getQueryData(queryKey);

      if (!currentUserId) {
        return { previousMessages, tempReactionId: null };
      }

      const shouldRemoveReaction = existingReaction?.reaction_type === reactionType;
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
    onMutate: (reactionId: string) => {
      // Do not await cancellation — optimistic removal must feel instant
      void queryClient.cancelQueries({ queryKey });
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

  const suppressOutsideCloseUntilRef = useRef(0);

  const handleLongPressStart = useCallback((e: React.TouchEvent) => {
    touchStartPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    longPressTimer.current = setTimeout(() => {
      console.log('[ChatMessage] Long press triggered for message:', id, 'type:', messageType);
      suppressOutsideCloseUntilRef.current = Date.now() + 900;
      suppressMenuUntilPointerUpRef.current = true;
      setIsDropdownOpen(false);
      setShowMenu(true);
      setShowReactionPicker(true);
    }, 600);
  }, [id, messageType]);

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
    if (addReactionMutation.isPending || removeReactionMutation.isPending) {
      console.log('[Reaction] Blocked by isPending guard', { addPending: addReactionMutation.isPending, removePending: removeReactionMutation.isPending });
      return;
    }

    if (existingReactionId) {
      removeReactionMutation.mutate(existingReactionId);
    } else {
      const latestReactions = getLatestReactions();
      const existingReaction = latestReactions.find((reaction) => reaction.user_id === currentUserId);
      console.log('[Reaction] handleReactionClick', { type, existingReaction: existingReaction ? { id: existingReaction.id, type: existingReaction.reaction_type } : null, willToggle: existingReaction?.reaction_type === type });
      addReactionMutation.mutate({ 
        reactionType: type, 
        existingReaction,
      });
    }
  }, [addReactionMutation, removeReactionMutation, getLatestReactions, currentUserId]);

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

  const openActionMenu = useCallback(() => {
    suppressOutsideCloseUntilRef.current = Date.now() + 500;
    setShowReactionPicker(false);
    setShowMenu(true);
    setIsDropdownOpen(true);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    openActionMenu();
  }, [openActionMenu]);

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
    if (!open && !showReactionPicker && Date.now() > menuClickGuardUntilRef.current) {
      setShowMenu(false);
    }
  }, [showReactionPicker]);

  useEffect(() => {
    const clearSuppressedMenuGesture = () => {
      suppressMenuUntilPointerUpRef.current = false;
      ignoreReactionDismissRef.current = false;
    };

    window.addEventListener('pointerup', clearSuppressedMenuGesture, true);
    window.addEventListener('pointercancel', clearSuppressedMenuGesture, true);

    return () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
      }
      window.removeEventListener('pointerup', clearSuppressedMenuGesture, true);
      window.removeEventListener('pointercancel', clearSuppressedMenuGesture, true);
    };
  }, []);

  // The reaction picker now uses a fullscreen backdrop (in MessageReactionsPopover),
  // so no document-level outside-click handler is needed here.

  // Close three-dot menu when tapping outside
  useEffect(() => {
    if (!showMenu || isDropdownOpen || showReactionPicker) return;
    
    const handleClickOutside = (e: Event) => {
      if (Date.now() < suppressOutsideCloseUntilRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-reaction-picker="true"]')) return;
      if (target?.closest?.('[role="menu"]')) return;
      // Don't close if tapping the three-dots menu button itself
      if (menuContainerRef.current?.contains(target as Node)) return;
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
  }, [showMenu, isDropdownOpen, showReactionPicker]);

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
      {isClubAnnouncement ? (
        <div className="h-8 w-8 shrink-0 rounded-full bg-primary flex items-center justify-center">
          <Megaphone className="h-4 w-4 text-primary-foreground" />
        </div>
      ) : (
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarImage src={authorAvatar || undefined} />
          <AvatarFallback className="text-xs">
            {displayName.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      )}
      <div className={`flex flex-col max-w-[75%] ${isOwn ? "items-end" : "items-start"}`}>
        {!isOwn && hasName && (
          <p className={`text-xs mb-1 ${isClubAnnouncement ? "font-semibold text-primary" : "text-muted-foreground"}`}>{displayName}</p>
        )}
        <ReplyIndicator replyToMessage={replyToMessage} isOwn={isOwn} />
        <div className="relative">
          <div
            ref={bubbleRef}
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
              onReact={(type) => handleReactionClick(type)}
              onRemove={(reactionId) => {
                if (addReactionMutation.isPending || removeReactionMutation.isPending) return;
                removeReactionMutation.mutate(reactionId);
              }}
              isMutating={addReactionMutation.isPending || removeReactionMutation.isPending}
              isOpen={showReactionPicker}
              onOpenChange={setShowReactionPicker}
              isOwnMessage={isOwn}
              anchorRef={bubbleRef}
              ignoreDismissRef={ignoreReactionDismissRef}
            />
          </div>
        </div>
        {/* Portalled menu trigger - renders above reaction picker backdrop */}
        {showMenu && menuPosition && createPortal(
          <div
            ref={menuContainerRef}
            className="fixed z-[100002]"
            style={{ top: menuPosition.top, left: menuPosition.left }}
            data-menu-trigger="true"
          >
            <DropdownMenu open={isDropdownOpen} onOpenChange={handleMenuOpenChange}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 min-h-[32px] min-w-[32px] bg-background/80 backdrop-blur-sm shadow-sm"
                  onPointerDown={(e) => {
                    if (suppressMenuUntilPointerUpRef.current) {
                      e.preventDefault();
                      e.stopPropagation();
                      return;
                    }
                    ignoreReactionDismissRef.current = true;
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    if (suppressMenuUntilPointerUpRef.current) {
                      e.preventDefault();
                      e.stopPropagation();
                      return;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    menuClickGuardUntilRef.current = Date.now() + 600;
                    setShowReactionPicker(false);
                    ignoreReactionDismissRef.current = false;
                    setShowMenu(true);
                    setIsDropdownOpen(true);
                  }}
                  onTouchStart={(e) => e.stopPropagation()}
                  onTouchEnd={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align={isOwn ? "end" : "start"}
                side="top"
                collisionPadding={16}
                className="z-[100003] bg-popover border"
                onCloseAutoFocus={(e) => e.preventDefault()}
              >
                {canReply && (
                  <DropdownMenuItem onClick={handleReply}>
                    <Reply className="h-4 w-4 mr-2" /> Reply
                  </DropdownMenuItem>
                )}
                {isOwn && !imageUrl && (
                  <DropdownMenuItem onClick={handleStartEdit}>
                    <Pencil className="h-4 w-4 mr-2" /> Edit
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
          </div>,
          document.body
        )}
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
          {!isPending && !isLastMessage && isOwn && readCount > 0 && (
            <span className="cursor-pointer underline" onClick={() => setShowReadReceipts(true)}>
              <MessageReadIndicator readCount={readCount} isOwn={isOwn} readerName={readerName} />
            </span>
          )}
          {!isPending && !isLastMessage && isOwn && readCount === 0 && (
            <MessageReadIndicator readCount={0} isOwn={isOwn} readerName={readerName} />
          )}
        </p>
        {!isPending && isLastMessage && isOwn && (
          readFrontierReaders.length > 0
            ? <div className="cursor-pointer" onClick={() => setShowReadReceipts(true)}>
                <MessageReadAvatars readers={readFrontierReaders} isOwn={isOwn} />
              </div>
            : <p className={`text-[10px] text-muted-foreground mt-0.5 ${isOwn ? "text-right" : ""}`}>Sent</p>
        )}
        {isOwn && (
          <ReadReceiptSheet
            open={showReadReceipts}
            onOpenChange={setShowReadReceipts}
            readers={isLastMessage ? readFrontierReaders : []}
            messageId={id}
            messageType={messageType}
            contextId={contextId || ""}
            currentUserId={currentUserId}
          />
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