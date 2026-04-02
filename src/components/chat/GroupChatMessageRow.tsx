import { memo, useState, useRef, useCallback, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Reply, Clock } from "lucide-react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { MessageContent } from "./MessageContent";
import { MessageReadAvatars } from "./MessageReadAvatars";
import { ReadReceiptSheet } from "./ReadReceiptSheet";
import type { ReaderInfo } from "@/hooks/useMessageReads";
import { useLongPressDismissGuard } from "@/hooks/useLongPressDismissGuard";
import { useSwipeToReply } from "@/hooks/useSwipeToReply";
import { MessageActionSheet } from "@/components/chat/MessageActionSheet";
import { ReportMessageDialog } from "@/components/chat/ReportMessageDialog";
import { BlockUserDialog } from "@/components/BlockUserDialog";

interface GroupMessage {
  id: string;
  text: string;
  image_url: string | null;
  created_at: string;
  author_id: string;
  group_id: string;
  reply_to_id: string | null;
  author?: { display_name: string | null; avatar_url: string | null };
  reply_to?: { text: string; author?: { display_name: string | null } } | null;
}

interface GroupChatMessageRowProps {
  msg: GroupMessage;
  messagesById: Map<string, GroupMessage>;
  isOwnMessage: boolean;
  isAdmin: boolean;
  highlightedMessageId: string | null;
  messageReactions: any[];
  reactions: any[];
  userId?: string;
  getProfile: (id: string) => { display_name: string | null; avatar_url: string | null } | null;
  readFrontier: Record<string, ReaderInfo[]>;
  readCounts: Record<string, number>;
  handleReply: (msg: GroupMessage) => void;
  handleEdit: (msg: GroupMessage) => void;
  deleteMessageMutation: { mutate: (id: string) => void };
  toggleReactionMutation: { mutate: (args: { messageId: string; reactionType: string }) => void };
  REACTION_EMOJIS: string[];
  groupId?: string;
}

export const GroupChatMessageRow = memo(function GroupChatMessageRow({
  msg,
  messagesById,
  isOwnMessage,
  isAdmin,
  highlightedMessageId,
  messageReactions,
  reactions,
  userId,
  getProfile,
  readFrontier,
  readCounts,
  handleReply,
  handleEdit,
  deleteMessageMutation,
  toggleReactionMutation,
  REACTION_EMOJIS,
  groupId,
}: GroupChatMessageRowProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showReadReceipts, setShowReadReceipts] = useState(false);
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [pickerPosition, setPickerPosition] = useState<{ top: number; left: number } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [tapFlash, setTapFlash] = useState(false);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const gestureModeRef = useRef<"idle" | "press" | "swipe">("idle");
  const {
    armDismissGuard,
    clearDismissGuard,
    consumeContextMenuGuard,
    preventIfGuarded,
  } = useLongPressDismissGuard();

  const closeActionUi = useCallback(() => {
    clearDismissGuard();
    setShowMenu(false);
    setShowReactionPicker(false);
    setShowActionSheet(false);
  }, [clearDismissGuard]);

  const closeReactionPicker = useCallback(() => {
    clearDismissGuard();
    setShowReactionPicker(false);
    setShowMenu(false);
    setShowActionSheet(false);
  }, [clearDismissGuard]);

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
      if (navigator.vibrate) navigator.vibrate(12);
      reactionPickerOpenedAtRef.current = Date.now();
      setShowMenu(true);
      setShowReactionPicker(true);
    }, 400);
  }, [armDismissGuard]);

  const handleReplyAction = useCallback(() => {
    handleReply(msg);
  }, [handleReply, msg]);

  const { swipeState, swipeHandlers: swipeToReplyHandlers, resetReplyReveal } = useSwipeToReply({
    enabled: true,
    onReply: handleReplyAction,
  });

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

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (consumeContextMenuGuard()) {
      return;
    }
    setShowMenu(true);
    setShowReactionPicker(true);
  }, [consumeContextMenuGuard]);

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

    window.addEventListener("pointercancel", handlePointerCancel, true);

    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
    };
  }, [clearDismissGuard, showReactionPicker]);

  useLayoutEffect(() => {
    if (!showReactionPicker || !bubbleRef.current) {
      setPickerPosition(null);
      return;
    }

    const updatePosition = () => {
      const bubble = bubbleRef.current;
      if (!bubble) return;

      const rect = bubble.getBoundingClientRect();
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const viewportOffsetTop = window.visualViewport?.offsetTop ?? 0;
      const rootStyles = getComputedStyle(document.documentElement);
      const bottomNavOffset = Number.parseFloat(rootStyles.getPropertyValue("--bottom-nav-offset")) || 0;

      const pickerWidth = Math.min(280, window.innerWidth - 16);
      const pickerHeight = 52;
      const topBoundary = viewportOffsetTop + 72;
      const composerSafeZone = 140;
      const bottomBoundary = viewportOffsetTop + viewportHeight - bottomNavOffset - composerSafeZone;
      const gap = 4;

      const spaceAbove = rect.top - topBoundary;
      const spaceBelow = bottomBoundary - rect.bottom;
      const showBelow = spaceAbove < pickerHeight && spaceBelow >= pickerHeight + gap;

      const unclampedTop = showBelow
        ? rect.bottom + gap
        : rect.top - pickerHeight - gap;
      const top = Math.max(
        topBoundary,
        Math.min(unclampedTop, bottomBoundary - pickerHeight)
      );

      let left = isOwnMessage ? rect.right - pickerWidth : rect.left;
      left = Math.max(8, Math.min(left, window.innerWidth - pickerWidth - 8));

      setPickerPosition({ top, left });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [isOwnMessage, showReactionPicker]);

  const profile = getProfile(msg.author_id);
  const displayName = profile?.display_name || msg.author?.display_name || "Loading...";
  const avatarUrl = profile?.avatar_url || msg.author?.avatar_url || undefined;
  const frontierReaders = readFrontier[msg.id] || [];
  const fallbackReplyMessage = !msg.reply_to && msg.reply_to_id
    ? messagesById.get(msg.reply_to_id) ?? null
    : null;
  const replyPreview = msg.reply_to ?? (fallbackReplyMessage
    ? {
        text: fallbackReplyMessage.text,
        author: {
          display_name:
            getProfile(fallbackReplyMessage.author_id)?.display_name ||
            fallbackReplyMessage.author?.display_name ||
            null,
        },
      }
    : null);

  const isInteracting = showMenu || showReactionPicker || showActionSheet;

  return (
    <div
      id={`message-${msg.id}`}
      className={`flex ${isOwnMessage ? "justify-end" : "justify-start"} ${
        highlightedMessageId === msg.id ? "bg-primary/10 rounded-lg" : ""
      } ${isInteracting ? "relative z-[100000]" : ""}`}
    >
      {isInteracting && createPortal(
        <div
          className="fixed inset-0 dark:bg-black/[0.22] bg-black/[0.28] z-[99999] animate-fade-in"
          style={{ animationDuration: '120ms' }}
          onClick={(e) => {
            // Ignore synthesized clicks within 400ms of reaction picker opening (iOS WebView)
            if (Date.now() - reactionPickerOpenedAtRef.current < 400) return;
            e.preventDefault();
            e.stopPropagation();
            closeActionUi();
          }}
          onTouchEnd={(e) => {
            // Ignore synthesized touch events within 400ms of reaction picker opening (iOS WebView)
            if (Date.now() - reactionPickerOpenedAtRef.current < 400) return;
            e.preventDefault();
            e.stopPropagation();
            closeActionUi();
          }}
        />,
        document.body
      )}
      <div className={`flex gap-2 max-w-[85%] group ${isOwnMessage ? "flex-row-reverse" : ""}`}>
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarImage src={avatarUrl} />
          <AvatarFallback>{displayName[0]?.toUpperCase() || "?"}</AvatarFallback>
        </Avatar>

        <div className={`flex flex-col ${isOwnMessage ? "items-end" : "items-start"}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium">{displayName}</span>
            {msg.id.startsWith("queued-") && (
              <span className="flex items-center text-amber-500" title="Pending sync">
                <Clock className="h-3 w-3" />
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {format(new Date(msg.created_at), "HH:mm")}
            </span>
          </div>

          {replyPreview && (
            <div className="text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded mb-1 border-l-2 border-primary">
              <span className="font-medium">{replyPreview.author?.display_name || "..."}: </span>
              <span className="line-clamp-1">{replyPreview.text.replace(/@\[([^\]]+)\]\([^)]+\)/g, '$1')}</span>
            </div>
          )}

          <div className="relative group/msg">
            {/* Swipe indicator - text only, shown when past threshold */}
            {swipeState.pastThreshold && (
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
                gestureModeRef.current = "press";
                handleLongPressStart(e);
                swipeToReplyHandlers.onTouchStart(e);
              }}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleLongPressEnd}
              onContextMenu={handleContextMenu}
            >
              <div
                ref={bubbleRef}
                className={`rounded-lg px-3 py-2 select-none transition-all duration-100 ${
                  isOwnMessage ? "bg-primary text-primary-foreground" : "bg-muted"
                } ${tapFlash ? "scale-[0.97] ring-2 ring-primary/40 brightness-[0.92] dark:brightness-[1.15]" : ""} ${isInteracting ? "scale-[1.01] border border-primary/[0.18] dark:border-primary/20" : "border border-transparent"}`}
                style={isInteracting ? (() => {
                  const isDark = document.documentElement.classList.contains('dark');
                  return {
                    boxShadow: '0 1px 2px 0 rgba(0,0,0,0.08)',
                    filter: isDark
                      ? (isOwnMessage ? 'brightness(1.08) saturate(1.03)' : 'brightness(1.08)')
                      : (isOwnMessage ? 'brightness(1.06)' : 'brightness(0.97)'),
                  };
                })() : undefined}
              >
                {msg.image_url && (
                  <img src={msg.image_url} alt="Attachment" className="max-w-xs rounded mb-2" />
                )}
                <MessageContent text={msg.text} />
              </div>
            </div>
          </div>

          {isOwnMessage && frontierReaders.length > 0 ? (
            <div className="cursor-pointer" onClick={() => setShowReadReceipts(true)}>
              <MessageReadAvatars readers={frontierReaders} isOwn={true} />
            </div>
          ) : isOwnMessage ? (
            <div className="mt-0.5">
              <span
                className={`text-[10px] text-muted-foreground ${(readCounts[msg.id] || 0) > 0 ? "cursor-pointer underline" : ""}`}
                onClick={(readCounts[msg.id] || 0) > 0 ? () => setShowReadReceipts(true) : undefined}
              >
                {(readCounts[msg.id] || 0) > 0 ? `Read by ${readCounts[msg.id]}` : "Sent"}
              </span>
            </div>
          ) : null}
          {isOwnMessage && (
            <ReadReceiptSheet
              open={showReadReceipts}
              onOpenChange={setShowReadReceipts}
              readers={frontierReaders}
              messageId={msg.id}
              messageType="group"
              contextId={groupId || msg.group_id}
              currentUserId={userId}
            />
          )}

          {messageReactions.length > 0 && (
            <GroupReactionBadges
              messageReactions={messageReactions}
              userId={userId}
              toggleReactionMutation={toggleReactionMutation}
              messageId={msg.id}
            />
          )}

          {showReactionPicker && pickerPosition && createPortal(
            <div
              className="fixed inset-0 z-[100001]"
              data-reaction-picker="true"
              onTouchStart={(e) => { e.stopPropagation(); }}
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  e.stopPropagation();
                  closeReactionPicker();
                }
              }}
              onTouchEnd={(e) => {
                if (e.target === e.currentTarget) {
                  e.stopPropagation();
                  e.preventDefault();
                  closeReactionPicker();
                }
              }}
            >
              <div
                className="absolute"
                style={{ top: pickerPosition.top, left: pickerPosition.left, width: "min(280px, calc(100vw - 16px))" }}
                onClick={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="bg-popover border rounded-lg p-2 shadow-lg">
                  <div className="flex gap-1.5">
                    {REACTION_EMOJIS.map((emoji) => {
                      const userReaction = reactions.find(
                        (r) => r.group_message_id === msg.id && r.user_id === userId
                      );
                      const isSelected = userReaction?.reaction_type === emoji;
                      return (
                        <button
                          key={emoji}
                          type="button"
                          className={`inline-flex items-center justify-center h-9 w-9 rounded-md text-lg shrink-0 active:bg-accent ${isSelected ? "bg-primary/20" : ""}`}
                          onTouchEnd={(e) => {
                            if (preventIfGuarded(e)) return;
                            e.stopPropagation();
                            e.preventDefault();
                            toggleReactionMutation.mutate({ messageId: msg.id, reactionType: emoji });
                            closeActionUi();
                          }}
                          onClick={(e) => {
                            if (preventIfGuarded(e)) return;
                            e.stopPropagation();
                            toggleReactionMutation.mutate({ messageId: msg.id, reactionType: emoji });
                            closeActionUi();
                          }}
                        >
                          {emoji}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )}
        </div>
      </div>
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
            <AlertDialogAction onClick={() => { deleteMessageMutation.mutate(msg.id); setShowDeleteConfirm(false); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
        isOwn={isOwnMessage}
        canReply={true}
        canEdit={isOwnMessage}
        canDelete={isOwnMessage || isAdmin}
        onReply={() => { handleReply(msg); closeActionUi(); }}
        onEdit={() => { handleEdit(msg); closeActionUi(); }}
        onDelete={() => { setShowDeleteConfirm(true); closeActionUi(); }}
        onReport={() => { setShowReportDialog(true); closeActionUi(); }}
        onBlock={() => { setShowBlockDialog(true); closeActionUi(); }}
      />
      {showReportDialog && (
        <ReportMessageDialog
          isOpen={showReportDialog}
          onClose={() => setShowReportDialog(false)}
          messageId={msg.id}
          messageType="group"
        />
      )}
      {showBlockDialog && (
        <BlockUserDialog
          open={showBlockDialog}
          onOpenChange={setShowBlockDialog}
          userId={msg.author_id}
          userName={msg.author?.display_name || "this user"}
        />
      )}
    </div>
  );
});

function GroupReactionBadges({
  messageReactions,
  userId,
  toggleReactionMutation,
  messageId,
}: {
  messageReactions: any[];
  userId?: string;
  toggleReactionMutation: { mutate: (args: { messageId: string; reactionType: string }) => void };
  messageId: string;
}) {
  const [openType, setOpenType] = useState<string | null>(null);

  const allUserIds = [...new Set(messageReactions.map((r: any) => r.user_id))];

  const { data: users = [] } = useQuery({
    queryKey: ["group-reaction-users", allUserIds],
    queryFn: async () => {
      if (allUserIds.length === 0) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", allUserIds);
      if (error) throw error;
      return data;
    },
    enabled: openType !== null && allUserIds.length > 0,
  });

  const grouped = messageReactions.reduce((acc: any, r: any) => {
    if (!acc[r.reaction_type]) acc[r.reaction_type] = [];
    acc[r.reaction_type].push(r);
    return acc;
  }, {} as Record<string, any[]>);

  const getUserName = (id: string) =>
    users.find((u: any) => u.id === id)?.display_name || "";

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {Object.entries(grouped).map(([type, items]: [string, any[]]) => {
        const userReaction = items.find((r: any) => r.user_id === userId);
        return (
          <Popover
            key={type}
            open={openType === type}
            onOpenChange={(open) => setOpenType(open ? type : null)}
          >
            <PopoverTrigger asChild>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenType(openType === type ? null : type);
                }}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors ${
                  userReaction ? "bg-primary/20 text-primary" : "bg-muted hover:bg-muted/80"
                }`}
              >
                <span>{type}</span>
                <span>{items.length}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent
              className="w-auto p-3 bg-popover border z-50"
              align="start"
              side="top"
              sideOffset={8}
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <div className="flex flex-col gap-2 min-w-[140px]">
                <p className="text-xs font-medium text-muted-foreground">
                  {type} ({items.length})
                </p>
                {items.map((r: any) => (
                  <p key={r.id} className="text-sm">
                    {getUserName(r.user_id)}
                    {r.user_id === userId && " (you)"}
                  </p>
                ))}
                {userReaction && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-destructive hover:text-destructive justify-start px-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleReactionMutation.mutate({ messageId, reactionType: type });
                      setOpenType(null);
                    }}
                  >
                    Remove your {type}
                  </Button>
                )}
              </div>
            </PopoverContent>
          </Popover>
        );
      })}
    </div>
  );
}
