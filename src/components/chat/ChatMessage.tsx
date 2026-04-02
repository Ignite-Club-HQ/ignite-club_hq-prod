import { useState, useRef, useEffect, useCallback, memo } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Reply, Clock, Megaphone } from "lucide-react";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { removeMessageFromCache } from "@/lib/messageCache";
import { MessageContent } from "./MessageContent";
import { MessageReactionsPopover, MessageReactionsDisplay } from "./MessageReactions";
import { ReplyIndicator } from "./ReplyPreview";
import { MessageReadAvatars } from "./MessageReadAvatars";
import { MessageReadIndicator } from "./MessageReadIndicator";
import { ReadReceiptSheet } from "./ReadReceiptSheet";
import type { ReaderInfo } from "@/hooks/useMessageReads";
import { useLongPressDismissGuard } from "@/hooks/useLongPressDismissGuard";
import { hapticImpactLight } from "@/lib/haptics";
import { toast } from "sonner";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import { useBlockedUsers } from "@/hooks/useBlockedUsers";
import { ReportMessageDialog } from "@/components/chat/ReportMessageDialog";
import { MessageActionSheet } from "@/components/chat/MessageActionSheet";
import { useSwipeToReply } from "@/hooks/useSwipeToReply";

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
  onEdit?: (message: { id: string; text: string }) => void;
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
  onEdit,
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
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [showReadReceipts, setShowReadReceipts] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [tapFlash, setTapFlash] = useState(false);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const longPressTriggeredRef = useRef(false);
  const gestureModeRef = useRef<"idle" | "press" | "swipe">("idle");
  const queryClient = useQueryClient();
  const { isBlocked } = useBlockedUsers();
  const {
    armDismissGuard,
    clearDismissGuard,
    consumeContextMenuGuard,
    preventIfGuarded,
  } = useLongPressDismissGuard();


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
  // Swipe to reply
  const handleReply = useCallback(() => {
    onReply?.({ id, text, authorName: authorName || null });
  }, [onReply, id, text, authorName]);

  const { swipeState, swipeHandlers: swipeToReplyHandlers, resetReplyReveal } = useSwipeToReply({
    enabled: canReply,
    onReply: handleReply,
  });

  // Track when the reaction picker was opened to ignore premature dismiss events on iOS
  const reactionPickerOpenedAtRef = useRef(0);

  const handleLongPressStart = useCallback((e: React.TouchEvent) => {
    gestureModeRef.current = "press";
    longPressTriggeredRef.current = false;
    touchStartPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    longPressTimer.current = setTimeout(() => {
      if (gestureModeRef.current !== "press") return;
      longPressTriggeredRef.current = true;
      resetReplyReveal();
      armDismissGuard();
      // Haptic feedback
      hapticImpactLight();
      reactionPickerOpenedAtRef.current = Date.now();
      setShowMenu(true);
      setShowReactionPicker(true);
    }, 400);
  }, [armDismissGuard]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartPos.current) return;

    const dx = e.touches[0].clientX - touchStartPos.current.x;
    const dy = e.touches[0].clientY - touchStartPos.current.y;

    if (gestureModeRef.current === "press" && dx > 12 && Math.abs(dy) < 24) {
      gestureModeRef.current = "swipe";
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      longPressTriggeredRef.current = false;
      // Force-activate the swipe hook so its directionality check doesn't reject the gesture
      swipeToReplyHandlers.forceActivate(touchStartPos.current.x, touchStartPos.current.y);
      swipeToReplyHandlers.onTouchMove(e);
      return;
    }

    if (gestureModeRef.current === "swipe") {
      swipeToReplyHandlers.onTouchMove(e);
      return;
    }

    if (longPressTimer.current && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
      touchStartPos.current = null;
    }
  }, [swipeToReplyHandlers]);

  const handleLongPressEnd = useCallback((e: React.TouchEvent) => {
    if (gestureModeRef.current === "swipe") {
      swipeToReplyHandlers.onTouchEnd();
      gestureModeRef.current = "idle";
      touchStartPos.current = null;
      longPressTriggeredRef.current = false;
      return;
    }

    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    // On iOS, pointercancel can reset longPressTriggeredRef during DOM mutations.
    // Check if the reaction picker was recently opened as a fallback.
    const recentlyOpenedPicker = Date.now() - reactionPickerOpenedAtRef.current < 600;

    if (longPressTriggeredRef.current || recentlyOpenedPicker) {
      e.preventDefault();
      e.stopPropagation();
      armDismissGuard();
      // Re-arm the backdrop guard from finger-release time, not picker-open time.
      // The user may hold for >400ms, so the original guard would have expired.
      reactionPickerOpenedAtRef.current = Date.now();
      requestAnimationFrame(() => {
        longPressTriggeredRef.current = false;
      });
    } else if (gestureModeRef.current === "press" && touchStartPos.current) {
      // Short tap — flash highlight then open action sheet
      e.preventDefault();
      e.stopPropagation();
      setTapFlash(true);
      if (navigator.vibrate) navigator.vibrate(6);
      setTimeout(() => {
        setTapFlash(false);
        setShowMenu(true);
        setShowActionSheet(true);
      }, 200);
    }

    touchStartPos.current = null;
    gestureModeRef.current = "idle";
  }, [armDismissGuard, swipeToReplyHandlers]);

  const handleReactionClick = useCallback((type: string, existingReactionId?: string) => {
    if (addReactionMutation.isPending || removeReactionMutation.isPending) {
      return;
    }

    clearDismissGuard();
    setShowReactionPicker(false);
    setShowMenu(false);
    setShowActionSheet(false);

    if (existingReactionId) {
      removeReactionMutation.mutate(existingReactionId);
      return;
    }

    const latestReactions = getLatestReactions();
    const existingReaction = latestReactions.find((reaction) => reaction.user_id === currentUserId);
    addReactionMutation.mutate({
      reactionType: type,
      existingReaction,
    });
  }, [addReactionMutation, clearDismissGuard, removeReactionMutation, getLatestReactions, currentUserId]);

  const closeReactionPicker = useCallback(() => {
    clearDismissGuard();
    setShowReactionPicker(false);
    setShowMenu(false);
    setShowActionSheet(false);
  }, [clearDismissGuard]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (consumeContextMenuGuard()) {
      return;
    }
    setShowMenu(true);
    setShowReactionPicker(true);
  }, [consumeContextMenuGuard]);


  const handleStartEdit = useCallback(() => {
    onEdit?.({ id, text });
  }, [onEdit, id, text]);

  const handleDelete = useCallback(() => {
    setShowDeleteConfirm(true);
  }, []);

  const confirmDelete = useCallback(() => {
    deleteMessageMutation.mutate();
    setShowDeleteConfirm(false);
  }, [deleteMessageMutation]);

  const handleShowReactions = useCallback(() => {
    setShowMenu(true);
    setShowReactionPicker(true);
  }, []);


  useEffect(() => {
    const handlePointerCancel = () => {
      // On iOS WebView, pointercancel fires when DOM changes (e.g. portal insertion
      // during long-press). Only reset if the reaction picker is NOT currently open,
      // otherwise we'd prematurely dismiss it.
      if (!showReactionPicker) {
        longPressTriggeredRef.current = false;
        clearDismissGuard();
      }
    };

    window.addEventListener('pointercancel', handlePointerCancel, true);

    return () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
      }
      window.removeEventListener('pointercancel', handlePointerCancel, true);
    };
  }, [clearDismissGuard, showReactionPicker]);

  // Get display name - never show placeholder text; hide name until profile loads
  const displayName = authorName || "";
  const hasName = !!authorName;


  // Hide messages from blocked users (after all hooks)
  if (!isOwn && isBlocked(authorId)) return null;

  const isInteracting = showMenu || showReactionPicker || showActionSheet;

  return (
    <div className={`flex gap-3 group ${isOwn ? "flex-row-reverse" : ""} ${isInteracting ? "relative z-[100000]" : ""}`}>
      {isInteracting && createPortal(
        <div
          className="fixed inset-0 dark:bg-black/[0.22] bg-black/[0.28] z-[99999] animate-fade-in"
          style={{ animationDuration: '120ms' }}
          onClick={(e) => {
            // Ignore synthesized clicks within 400ms of reaction picker opening (iOS WebView)
            if (Date.now() - reactionPickerOpenedAtRef.current < 400) return;
            e.preventDefault();
            e.stopPropagation();
            clearDismissGuard();
            setShowReactionPicker(false);
            setShowMenu(false);
            setShowActionSheet(false);
          }}
          onTouchEnd={(e) => {
            // Ignore synthesized touch events within 400ms of reaction picker opening (iOS WebView)
            if (Date.now() - reactionPickerOpenedAtRef.current < 400) return;
            e.preventDefault();
            e.stopPropagation();
            clearDismissGuard();
            setShowReactionPicker(false);
            setShowMenu(false);
            setShowActionSheet(false);
          }}
        />,
        document.body
      )}
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
        <div className="relative group/msg">
          {/* Swipe indicator - text only, shown when past threshold */}
          {canReply && swipeState.pastThreshold && (
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 pointer-events-none z-0 flex items-center pl-1"
              style={{
                opacity: 1,
                transition: swipeState.isSwiping ? 'none' : 'opacity 0.2s ease-out',
              }}
            >
              <span className="text-[10px] font-medium text-primary whitespace-nowrap animate-in fade-in-0 duration-100">
                Release to reply
              </span>
            </div>
          )}
          {/* Swipe-to-reply wrapper */}
          <div
            style={{
              transform: swipeState.offsetX > 0 ? `translateX(${swipeState.offsetX}px)` : undefined,
              transition: swipeState.isSwiping ? 'none' : 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
            onTouchStart={(e) => {
              handleLongPressStart(e);
              swipeToReplyHandlers.onTouchStart(e);
            }}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleLongPressEnd}
            onContextMenu={handleContextMenu}
          >
            <div
              ref={bubbleRef}
              className={`relative rounded-2xl px-4 py-2 select-none transition-all duration-100 ${
                isOwn
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-muted rounded-bl-sm"
              } ${tapFlash ? "scale-[0.97] ring-2 ring-primary/40 brightness-[0.92] dark:brightness-[1.15]" : ""} ${isInteracting ? "scale-[1.01] border border-primary/[0.18] dark:border-primary/20" : "border border-transparent"}`}
              style={isInteracting ? (() => {
                const isDark = document.documentElement.classList.contains('dark');
                return {
                  boxShadow: '0 1px 2px 0 rgba(0,0,0,0.08)',
                  filter: isDark
                    ? (isOwn ? 'brightness(1.08) saturate(1.03)' : 'brightness(1.08)')
                    : (isOwn ? 'brightness(1.06)' : 'brightness(0.97)'),
                };
              })() : undefined}
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
                preventIfGuarded={preventIfGuarded}
                onOpenChange={(open) => {
                  if (open) {
                    setShowReactionPicker(true);
                    return;
                  }
                  closeReactionPicker();
                }}
                isOwnMessage={isOwn}
                anchorRef={bubbleRef}
              />
            </div>
          </div>
        </div>
        {/* Action sheet (replaces 3-dot dropdown menu) */}
        <MessageActionSheet
          open={showActionSheet}
          onOpenChange={(open) => {
            setShowActionSheet(open);
            if (!open) {
              setShowMenu(false);
              setShowReactionPicker(false);
              clearDismissGuard();
            }
          }}
          isOwn={isOwn}
          canReply={canReply}
          canEdit={isOwn && !imageUrl}
          canDelete={canDelete}
          isSystemMessage={isSystemMessage}
          onReply={handleReply}
          onEdit={handleStartEdit}
          onDelete={handleDelete}
          onReport={() => setShowReportDialog(true)}
          onBlock={() => setShowBlockDialog(true)}
        />
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
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete message?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This message will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});