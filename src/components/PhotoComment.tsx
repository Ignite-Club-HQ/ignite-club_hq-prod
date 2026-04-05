import { useState, useRef, useCallback, useEffect, memo } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, Check, X, Reply, ShieldAlert, Flag } from "lucide-react";
import { formatTimeShort } from "@/lib/formatTimeShort";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useBlockedUsers } from "@/hooks/useBlockedUsers";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import { ReportCommentDialog } from "@/components/ReportCommentDialog";
import { CommentReactionPicker } from "@/components/CommentReactionPicker";
import { CommentReactionsDisplay } from "@/components/CommentReactionsDisplay";
import { MessageActionSheet } from "@/components/chat/MessageActionSheet";
import { useLongPressDismissGuard } from "@/hooks/useLongPressDismissGuard";
import { hapticImpactLight, hapticSelectionTick } from "@/lib/haptics";

const REACTION_EMOJIS = [
  { type: "like", emoji: "❤️" },
  { type: "fire", emoji: "🔥" },
  { type: "clap", emoji: "👏" },
  { type: "laugh", emoji: "😂" },
  { type: "thumbsup", emoji: "👍" },
  { type: "sad", emoji: "😢" },
];

interface CommentReaction {
  id: string;
  user_id: string;
  reaction_type: string;
}

interface PhotoCommentProps {
  id: string;
  text: string;
  userId: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  currentUserId?: string;
  replyToName?: string | null;
  onReply?: (commentId: string, displayName: string) => void;
  isReply?: boolean;
  createdAt?: string;
}

export const PhotoComment = memo(function PhotoComment({
  id,
  text,
  userId,
  displayName,
  avatarUrl,
  currentUserId,
  replyToName,
  onReply,
  isReply = false,
  createdAt,
}: PhotoCommentProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(text);
  const [displayText, setDisplayText] = useState(text);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [tapFlash, setTapFlash] = useState(false);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const commentRef = useRef<HTMLDivElement>(null);
  const longPressTriggeredRef = useRef(false);
  const reactionPickerOpenedAtRef = useRef(0);
  const queryClient = useQueryClient();
  const isOwn = userId === currentUserId;
  const { isBlocked } = useBlockedUsers();
  const {
    armDismissGuard,
    clearDismissGuard,
    consumeContextMenuGuard,
  } = useLongPressDismissGuard();

  const isInteracting = showReactionPicker || showActionSheet;

  // Fetch reactions for this comment
  const { data: reactions = [] } = useQuery({
    queryKey: ["comment-reactions", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("photo_comment_reactions")
        .select("id, user_id, reaction_type")
        .eq("comment_id", id);
      if (error) throw error;
      return data as CommentReaction[];
    },
  });

  const addReactionMutation = useMutation({
    mutationFn: async (reactionType: string) => {
      await supabase
        .from("photo_comment_reactions")
        .delete()
        .eq("comment_id", id)
        .eq("user_id", currentUserId!);
      const { error } = await supabase.from("photo_comment_reactions").insert({
        comment_id: id,
        user_id: currentUserId!,
        reaction_type: reactionType,
      });
      if (error) throw error;
    },
    onMutate: async (reactionType: string) => {
      await queryClient.cancelQueries({ queryKey: ["comment-reactions", id] });
      const previousReactions = queryClient.getQueryData(["comment-reactions", id]);
      queryClient.setQueryData(["comment-reactions", id], (old: CommentReaction[] | undefined) => {
        if (!old) return [{ id: `temp-${Date.now()}`, user_id: currentUserId!, reaction_type: reactionType }];
        const filtered = old.filter(r => r.user_id !== currentUserId);
        return [...filtered, { id: `temp-${Date.now()}`, user_id: currentUserId!, reaction_type: reactionType }];
      });
      return { previousReactions };
    },
    onError: (err, variables, context) => {
      if (context?.previousReactions) {
        queryClient.setQueryData(["comment-reactions", id], context.previousReactions);
      }
      toast.error("Failed to add reaction");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["comment-reactions", id] });
    },
  });

  const removeReactionMutation = useMutation({
    mutationFn: async () => {
      const userReaction = reactions.find((r) => r.user_id === currentUserId);
      if (userReaction?.id?.startsWith("temp-")) return;
      const { error } = await supabase
        .from("photo_comment_reactions")
        .delete()
        .eq("comment_id", id)
        .eq("user_id", currentUserId!);
      if (error) throw error;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["comment-reactions", id] });
      const previousReactions = queryClient.getQueryData(["comment-reactions", id]);
      queryClient.setQueryData(["comment-reactions", id], (old: CommentReaction[] | undefined) => {
        if (!old) return [];
        return old.filter(r => r.user_id !== currentUserId);
      });
      return { previousReactions };
    },
    onError: (err, variables, context) => {
      if (context?.previousReactions) {
        queryClient.setQueryData(["comment-reactions", id], context.previousReactions);
      }
      toast.error("Failed to remove reaction");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["comment-reactions", id] });
    },
  });

  const handleEmojiClick = useCallback((type: string) => {
    const userReaction = reactions.find((r) => r.user_id === currentUserId);
    if (userReaction?.reaction_type === type) {
      removeReactionMutation.mutate();
    } else {
      addReactionMutation.mutate(type);
    }
    clearDismissGuard();
    setShowReactionPicker(false);
  }, [reactions, currentUserId, removeReactionMutation, addReactionMutation, clearDismissGuard]);

  const editMutation = useMutation({
    mutationFn: async (newText: string) => {
      const { error } = await supabase
        .from("photo_comments")
        .update({ text: newText })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, newText) => {
      setDisplayText(newText);
      queryClient.invalidateQueries({ queryKey: ["all-photo-comments"] });
      setIsEditing(false);
      toast.success("Comment updated");
    },
    onError: () => {
      toast.error("Failed to update comment");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("photo_comments")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-photo-comments"] });
      toast.success("Comment deleted");
    },
    onError: () => {
      toast.error("Failed to delete comment");
    },
  });

  const handleSave = () => {
    if (editText.trim() && editText !== text) {
      editMutation.mutate(editText.trim());
    } else {
      setIsEditing(false);
      setEditText(text);
    }
  };

  // Long press → emoji reaction picker (matches message thread)
  const handleLongPressStart = useCallback((e: React.TouchEvent) => {
    longPressTriggeredRef.current = false;
    touchStartPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    longPressTimer.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      armDismissGuard();
      hapticImpactLight();
      reactionPickerOpenedAtRef.current = Date.now();
      setShowReactionPicker(true);
    }, 400);
  }, [armDismissGuard]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (longPressTimer.current && touchStartPos.current) {
      const dx = e.touches[0].clientX - touchStartPos.current.x;
      const dy = e.touches[0].clientY - touchStartPos.current.y;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
        touchStartPos.current = null;
      }
    }
  }, []);

  // Short tap → action sheet, long press end → keep reaction picker open
  const handleLongPressEnd = useCallback((e: React.TouchEvent) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    const recentlyOpenedPicker = Date.now() - reactionPickerOpenedAtRef.current < 600;

    if (longPressTriggeredRef.current || recentlyOpenedPicker) {
      e.preventDefault();
      e.stopPropagation();
      armDismissGuard();
      reactionPickerOpenedAtRef.current = Date.now();
      requestAnimationFrame(() => {
        longPressTriggeredRef.current = false;
      });
    } else if (touchStartPos.current) {
      // Short tap → action sheet
      e.preventDefault();
      e.stopPropagation();
      setTapFlash(true);
      hapticSelectionTick();
      setTimeout(() => {
        setTapFlash(false);
        setShowActionSheet(true);
      }, 200);
    }

    touchStartPos.current = null;
  }, [armDismissGuard]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (consumeContextMenuGuard()) return;
    setShowReactionPicker(true);
  }, [consumeContextMenuGuard]);

  const closeInteraction = useCallback(() => {
    clearDismissGuard();
    setShowReactionPicker(false);
    setShowActionSheet(false);
  }, [clearDismissGuard]);

  // Cleanup timer on unmount
  useEffect(() => {
    const handlePointerCancel = () => {
      if (!showReactionPicker) {
        longPressTriggeredRef.current = false;
        clearDismissGuard();
      }
    };
    window.addEventListener('pointercancel', handlePointerCancel, true);
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      window.removeEventListener('pointercancel', handlePointerCancel, true);
    };
  }, [clearDismissGuard, showReactionPicker]);

  if (isEditing) {
    return (
      <div className={`flex gap-2 items-center ${isReply ? "ml-8" : ""}`}>
        <Avatar className="h-6 w-6">
          <AvatarImage src={avatarUrl || undefined} />
          <AvatarFallback className="text-xs">
            {displayName?.[0] || "?"}
          </AvatarFallback>
        </Avatar>
        <Input
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          className="flex-1 h-7 text-sm"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") {
              setIsEditing(false);
              setEditText(text);
            }
          }}
        />
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleSave}>
          <Check className="h-3 w-3" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => {
            setIsEditing(false);
            setEditText(text);
          }}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  // Hide comments from blocked users
  if (!isOwn && isBlocked(userId)) return null;

  return (
    <div className={`flex flex-col gap-1 ${isReply ? "ml-8" : ""} ${isInteracting ? "relative z-[100000]" : ""}`}>
      {/* Dimmed backdrop when interacting (matches message thread) */}
      {isInteracting && createPortal(
        <div
          className="fixed inset-0 dark:bg-black/[0.22] bg-black/[0.28] z-[99999] animate-fade-in"
          style={{ animationDuration: '120ms' }}
          onClick={(e) => {
            if (Date.now() - reactionPickerOpenedAtRef.current < 400) return;
            e.preventDefault();
            e.stopPropagation();
            closeInteraction();
          }}
          onTouchEnd={(e) => {
            if (Date.now() - reactionPickerOpenedAtRef.current < 400) return;
            e.preventDefault();
            e.stopPropagation();
            closeInteraction();
          }}
        />,
        document.body
      )}
      <div className="flex gap-2">
        <Avatar className="h-6 w-6">
          <AvatarImage src={avatarUrl || undefined} />
          <AvatarFallback className="text-xs">
            {displayName?.[0] || "?"}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <div
            ref={commentRef}
            className={`select-none rounded-lg px-2 py-1 transition-all duration-100 ${
              tapFlash ? "bg-muted/60 scale-[0.98]" : ""
            } ${isInteracting ? "bg-muted/40 scale-[1.01]" : ""}`}
            onTouchStart={handleLongPressStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleLongPressEnd}
            onContextMenu={handleContextMenu}
          >
            {replyToName && (
              <p className="text-xs text-muted-foreground mb-0.5">
                ↳ Replying to {replyToName}
              </p>
            )}
            <p className="text-sm">
              <span className="font-medium">{displayName}</span>{" "}
              {displayText}
              {createdAt && (
                <span className="text-xs text-muted-foreground ml-2">
                  · {formatTimeShort(createdAt)}
                </span>
              )}
            </p>
          </div>
          {/* Reaction picker - floating above comment on long press */}
          <CommentReactionPicker
            isOpen={showReactionPicker}
            reactions={reactions}
            currentUserId={currentUserId}
            onEmojiClick={handleEmojiClick}
            onClose={closeInteraction}
            anchorRef={commentRef}
          />
          {/* Reaction display */}
          <CommentReactionsDisplay
            reactions={reactions}
            currentUserId={currentUserId}
            onReactionClick={handleEmojiClick}
          />
        </div>
      </div>

      {/* Action sheet - same as message thread */}
      <MessageActionSheet
        open={showActionSheet}
        onOpenChange={(open) => {
          setShowActionSheet(open);
          if (!open) closeInteraction();
        }}
        isOwn={isOwn}
        canReply={!!onReply}
        canEdit={isOwn}
        canDelete={isOwn}
        isSystemMessage={false}
        onReply={() => onReply?.(id, displayName || "Unknown")}
        onEdit={() => setIsEditing(true)}
        onDelete={() => setShowDeleteConfirm(true)}
        onReport={() => setShowReportDialog(true)}
        onBlock={() => setShowBlockDialog(true)}
      />

      {showBlockDialog && (
        <BlockUserDialog
          open={showBlockDialog}
          onOpenChange={setShowBlockDialog}
          userId={userId}
          userName={displayName || "this user"}
        />
      )}
      {showReportDialog && (
        <ReportCommentDialog
          isOpen={showReportDialog}
          onClose={() => setShowReportDialog(false)}
          commentId={id}
        />
      )}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete comment?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This comment will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { deleteMutation.mutate(); setShowDeleteConfirm(false); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});

export { REACTION_EMOJIS };
export type { CommentReaction };
