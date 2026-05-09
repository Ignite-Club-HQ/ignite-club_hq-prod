import { memo, useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Reply, Clock, Check, ImagePlus, Loader2 } from "lucide-react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { MessageContent } from "./MessageContent";
import { FullscreenImageViewer } from "./FullscreenImageViewer";
import { MessageReadAvatars } from "./MessageReadAvatars";
import { ReadReceiptSheet } from "./ReadReceiptSheet";
import type { ReaderInfo } from "@/hooks/useMessageReads";
import { useLongPressDismissGuard } from "@/hooks/useLongPressDismissGuard";
import { hapticImpactLight, hapticSelectionTick } from "@/lib/haptics";
import { useSwipeToReply } from "@/hooks/useSwipeToReply";
import { MessageActionSheet } from "@/components/chat/MessageActionSheet";
import { ReportMessageDialog } from "@/components/chat/ReportMessageDialog";
import { isMembershipSystemText } from "@/lib/systemMessagePatterns";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import { MessageReactionsPopover } from "./MessageReactions";
import { ReplyIndicator } from "./ReplyPreview";

const GROUP_REACTION_EMOJI_MAP: Record<string, string> = {
  "❤️": "❤️",
  "🔥": "🔥",
  "👏": "👏",
  "😂": "😂",
  "👍": "👍",
  "😢": "😢",
  like: "❤️",
  fire: "🔥",
  clap: "👏",
  laugh: "😂",
  thumbsup: "👍",
  sad: "😢",
};

const normalizeGroupReactionType = (reactionType?: string | null) => {
  if (!reactionType) return "";
  return GROUP_REACTION_EMOJI_MAP[reactionType] || reactionType;
};

interface GroupMessage {
  id: string;
  text: string;
  image_url: string | null;
  created_at: string;
  author_id: string;
  group_id: string;
  reply_to_id: string | null;
  is_system_message?: boolean;
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
  userId?: string;
  getProfile: (id: string) => { display_name: string | null; avatar_url: string | null } | null;
  readFrontier: Record<string, ReaderInfo[]>;
  readCounts: Record<string, number>;
  handleReply: (msg: GroupMessage) => void;
  handleEdit: (msg: GroupMessage) => void;
  deleteMessageMutation: { mutate: (id: string) => void };
  toggleReactionMutation: { mutate: (args: { messageId: string; reactionType: string }) => void };
  groupId?: string;
  searchQuery?: string;
  isPinned?: boolean;
  pinLimitReached?: boolean;
  onPin?: (messageId: string) => void;
  onUnpin?: (messageId: string) => void;
  canPublishToGallery?: boolean;
  isPublishingToGallery?: boolean;
  isPublishedToGallery?: boolean;
  onPublishToGallery?: (messageId: string, imageUrl: string) => void;
}

export const GroupChatMessageRow = memo(function GroupChatMessageRow({
  msg,
  messagesById,
  isOwnMessage,
  isAdmin,
  highlightedMessageId,
  messageReactions,
  userId,
  getProfile,
  readFrontier,
  readCounts,
  handleReply,
  handleEdit,
  deleteMessageMutation,
  toggleReactionMutation,
  groupId,
  searchQuery,
  isPinned = false,
  pinLimitReached = false,
  onPin,
  onUnpin,
  canPublishToGallery = false,
  isPublishingToGallery = false,
  isPublishedToGallery = false,
  onPublishToGallery,
}: GroupChatMessageRowProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showReadReceipts, setShowReadReceipts] = useState(false);
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [showFullscreenImage, setShowFullscreenImage] = useState(false);
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
      hapticImpactLight();
      window.getSelection?.()?.removeAllRanges();
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
      hapticSelectionTick();
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
  const currentUserReaction = messageReactions.find(
    (reaction) => reaction.user_id === userId,
  );
  const normalizedMessageReactions = messageReactions.map((reaction) => ({
    ...reaction,
    reaction_type: normalizeGroupReactionType(reaction.reaction_type),
  }));

  const handleReactionPickerReact = useCallback((reactionType: string) => {
    const isSelected = normalizeGroupReactionType(currentUserReaction?.reaction_type) === reactionType;

    toggleReactionMutation.mutate({
      messageId: msg.id,
      reactionType: isSelected ? (currentUserReaction?.reaction_type || reactionType) : reactionType,
    });

    closeActionUi();
  }, [closeActionUi, currentUserReaction, msg.id, toggleReactionMutation]);

  const handleReactionPickerRemove = useCallback((reactionId: string) => {
    const reaction = messageReactions.find((item) => item.id === reactionId);
    if (!reaction) return;

    toggleReactionMutation.mutate({
      messageId: msg.id,
      reactionType: reaction.reaction_type,
    });

    closeActionUi();
  }, [closeActionUi, messageReactions, msg.id, toggleReactionMutation]);

  const isInteracting = showMenu || showReactionPicker || showActionSheet;

  // System messages (e.g. "Alex joined as Coach") render as a centered grey pill,
  // WhatsApp-style: no avatar, no actions, no reactions.
  if (msg.is_system_message || isMembershipSystemText(msg.text)) {
    return (
      <div id={`message-${msg.id}`} className="flex justify-center my-2 px-4">
        <div className="max-w-[85%] rounded-full bg-muted/70 px-3 py-1 text-center text-[11px] text-muted-foreground">
          {msg.text}
        </div>
      </div>
    );
  }

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
      <div className={`flex w-full min-w-0 gap-2 max-w-[85%] group ${isOwnMessage ? "flex-row-reverse" : ""}`}>
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarImage src={avatarUrl} />
          <AvatarFallback>{displayName[0]?.toUpperCase() || "?"}</AvatarFallback>
        </Avatar>

        <div className={`flex w-full min-w-0 max-w-full flex-col ${isOwnMessage ? "items-end" : "items-start"}`}>
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

          <ReplyIndicator
            replyToMessage={replyPreview ? { text: replyPreview.text, authorName: replyPreview.author?.display_name || null } : null}
            hasReply={!!msg.reply_to_id}
            isOwn={isOwnMessage}
          />

          <div className="relative min-w-0 max-w-full group/msg">
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
                className="min-w-0 max-w-full"
              style={{
                transform: swipeState.offsetX > 0 ? `translateX(${swipeState.offsetX}px)` : undefined,
                  transition: swipeState.isSwiping || swipeState.offsetX === 0 ? 'none' : 'transform 0.2s ease-out',
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
                className={`relative max-w-full rounded-lg px-3 py-2 select-none overflow-hidden ${
                  isOwnMessage ? "bg-chat-bubble-own text-chat-bubble-own-foreground" : "bg-muted"
                } ${tapFlash ? "ring-2 ring-primary/40 brightness-[0.92] dark:brightness-[1.15]" : ""} ${isInteracting ? "border border-primary/[0.18] dark:border-primary/20" : "border border-transparent"}`}
                style={isInteracting ? (() => {
                  const isDark = document.documentElement.classList.contains('dark');
                  return {
                    boxShadow: '0 1px 2px 0 rgba(0,0,0,0.08)',
                    filter: isDark
                      ? (isOwnMessage ? 'brightness(1.08) saturate(1.03)' : 'brightness(1.08)')
                      : (isOwnMessage ? 'brightness(1.06)' : 'brightness(0.97)'),
                  };
                })() : undefined}
                onPointerDown={(e) => e.preventDefault()}
                onContextMenu={(e) => e.preventDefault()}
                onDragStart={(e) => e.preventDefault()}
              >
                <div className="text-sm min-w-0 max-w-full overflow-hidden">
                  <MessageContent
                    text={msg.text}
                    imageUrl={msg.image_url}
                    searchQuery={searchQuery}
                    showPreviews={false}
                    showImageActions={!isOwnMessage && !!msg.image_url}
                    onReportImage={() => setShowReportDialog(true)}
                    onBlockImageAuthor={() => setShowBlockDialog(true)}
                  />
                </div>
              </div>
            </div>
          </div>
          {/* Inline "Add to gallery" chip — only on own image messages */}
          {canPublishToGallery && isOwnMessage && msg.image_url && onPublishToGallery && !msg.id.startsWith("queued-") && (
            <div className={`mt-1 flex ${isOwnMessage ? "justify-end" : "justify-start"}`}>
              <button
                type="button"
                disabled={isPublishingToGallery || isPublishedToGallery}
                aria-busy={isPublishingToGallery || undefined}
                aria-disabled={isPublishingToGallery || isPublishedToGallery || undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isPublishingToGallery || isPublishedToGallery) return;
                  onPublishToGallery(msg.id, msg.image_url!);
                }}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${
                  isPublishedToGallery
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 cursor-default"
                    : isPublishingToGallery
                      ? "bg-primary/10 text-primary cursor-wait animate-pulse"
                      : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground active:scale-[0.97] cursor-pointer"
                }`}
                aria-label={
                  isPublishingToGallery
                    ? "Adding to media gallery"
                    : isPublishedToGallery
                      ? "Already in gallery"
                      : "Add to media gallery"
                }
              >
                {isPublishingToGallery ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                ) : isPublishedToGallery ? (
                  <Check className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <ImagePlus className="h-3 w-3" aria-hidden="true" />
                )}
                <span>
                  {isPublishingToGallery
                    ? "Adding…"
                    : isPublishedToGallery
                      ? "In gallery"
                      : "Add to gallery"}
                </span>
              </button>
            </div>
          )}
          {/* Link previews rendered outside the message bubble */}
          <div className="w-full min-w-0 max-w-full self-stretch overflow-hidden">
            <MessageContent text={msg.text} previewsOnly />
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

          <MessageReactionsPopover
            reactions={normalizedMessageReactions}
            currentUserId={userId}
            onReact={handleReactionPickerReact}
            onRemove={handleReactionPickerRemove}
            isMutating={false}
            isOpen={showReactionPicker}
            preventIfGuarded={preventIfGuarded}
            onOpenChange={(open) => {
              if (open) {
                setShowReactionPicker(true);
                return;
              }
              closeReactionPicker();
            }}
            isOwnMessage={isOwnMessage}
            anchorRef={bubbleRef}
          />
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
        messageText={msg.text}
        onReply={() => { handleReply(msg); closeActionUi(); }}
        onEdit={() => { handleEdit(msg); closeActionUi(); }}
        onDelete={() => { setShowDeleteConfirm(true); closeActionUi(); }}
        onReport={() => { setShowReportDialog(true); closeActionUi(); }}
        onBlock={() => { setShowBlockDialog(true); closeActionUi(); }}
        hasImage={!!msg.image_url}
        onViewImage={() => { setShowFullscreenImage(true); closeActionUi(); }}
        canPin={!!onPin || isPinned}
        isPinned={isPinned}
        pinLimitReached={pinLimitReached}
        onPin={onPin ? () => { onPin(msg.id); closeActionUi(); } : undefined}
        onUnpin={onUnpin ? () => { onUnpin(msg.id); closeActionUi(); } : undefined}
      />
      {showFullscreenImage && msg.image_url && (
        <FullscreenImageViewer
          src={msg.image_url}
          alt="Attachment"
          onClose={() => setShowFullscreenImage(false)}
        />
      )}
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
  const [viewingType, setViewingType] = useState<string | null>(null);
  const grouped = messageReactions.reduce((acc: any, r: any) => {
    const normalizedType = normalizeGroupReactionType(r.reaction_type);
    if (!acc[normalizedType]) acc[normalizedType] = [];
    acc[normalizedType].push(r);
    return acc;
  }, {} as Record<string, any[]>);

  const allUserIds = [...new Set(messageReactions.map((r: any) => r.user_id))];

  return (
    <>
      <div className="relative z-10 flex flex-wrap gap-1 mt-1">
        {Object.entries(grouped).map(([type, items]: [string, any[]]) => {
          const userReaction = items.find((r: any) => r.user_id === userId);
          const emoji = normalizeGroupReactionType(type);
          return (
            <button
              key={type}
              onClick={(e) => {
                e.stopPropagation();
                setViewingType(type);
              }}
              className={`inline-flex items-center gap-0.5 pl-1.5 pr-1.5 py-[1px] rounded-full text-[11px] leading-none ring-1 ring-background transition-colors ${
                userReaction ? "bg-primary/15 text-primary" : "bg-muted/80 text-foreground/75 hover:bg-muted"
              }`}
            >
              <span className="text-[12px] leading-none">{emoji}</span>
              <span className="tabular-nums">{items.length}</span>
            </button>
          );
        })}
      </div>

      <GroupReactionsDialog
        messageReactions={messageReactions}
        grouped={grouped}
        allUserIds={allUserIds}
        userId={userId}
        toggleReactionMutation={toggleReactionMutation}
        messageId={messageId}
        viewingType={viewingType}
        onClose={() => setViewingType(null)}
        onChangeType={setViewingType}
      />
    </>
  );
}

function GroupReactionsDialog({
  messageReactions,
  grouped,
  allUserIds,
  userId,
  toggleReactionMutation,
  messageId,
  viewingType,
  onClose,
  onChangeType,
}: {
  messageReactions: any[];
  grouped: Record<string, any[]>;
  allUserIds: string[];
  userId?: string;
  toggleReactionMutation: { mutate: (args: { messageId: string; reactionType: string }) => void };
  messageId: string;
  viewingType: string | null;
  onClose: () => void;
  onChangeType: (type: string) => void;
}) {
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
    enabled: !!viewingType && allUserIds.length > 0,
  });

  const getUserName = (uid: string) =>
    users.find((u: any) => u.id === uid)?.display_name || "Unknown User";

  const viewingReactors = viewingType ? (grouped[viewingType] || []) : [];
  const viewingEmoji = viewingType ? normalizeGroupReactionType(viewingType) : "";

  return (
    <Dialog open={!!viewingType} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-xl">{viewingEmoji}</span>
            <span>Reactions</span>
          </DialogTitle>
        </DialogHeader>

        {/* Reaction type tabs */}
        <div className="flex gap-1 pb-2 border-b">
          {Object.entries(grouped).map(([type, items]: [string, any[]]) => {
            const emoji = normalizeGroupReactionType(type);
            return (
              <Button
                key={type}
                variant={viewingType === type ? "secondary" : "ghost"}
                size="sm"
                onClick={() => onChangeType(type)}
                className="h-8 px-2 gap-1"
              >
                <span>{emoji}</span>
                <span className="text-xs">{items.length}</span>
              </Button>
            );
          })}
        </div>

        <ScrollArea className="max-h-[300px]">
          <div className="space-y-2">
            {viewingReactors.map((r: any) => {
              const isCurrentUser = r.user_id === userId;
              return (
                <div key={r.id || r.user_id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/50">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-primary/20 text-primary text-sm">
                      {getUserName(r.user_id)?.charAt(0)?.toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium flex-1">
                    {getUserName(r.user_id)}
                    {isCurrentUser && <span className="text-muted-foreground font-normal"> (you)</span>}
                  </span>
                  {isCurrentUser && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleReactionMutation.mutate({ messageId, reactionType: r.reaction_type });
                        onClose();
                      }}
                      className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                    >
                      Remove
                    </Button>
                  )}
                </div>
              );
            })}
            {viewingReactors.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">No reactions</p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
