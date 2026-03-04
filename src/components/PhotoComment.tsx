import { useState, useRef, useCallback, useEffect, memo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreVertical, Pencil, Trash2, Check, X, Reply, ShieldAlert, Flag } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
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
import { toast } from "sonner";
import { useBlockedUsers } from "@/hooks/useBlockedUsers";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import { ReportCommentDialog } from "@/components/ReportCommentDialog";
import { CommentReactionPicker } from "@/components/CommentReactionPicker";
import { CommentReactionsDisplay } from "@/components/CommentReactionsDisplay";

const REACTION_EMOJIS = [
  { type: "like", emoji: "❤️" },
  { type: "fire", emoji: "🔥" },
  { type: "clap", emoji: "👏" },
  { type: "laugh", emoji: "😂" },
  { type: "wow", emoji: "😮" },
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
  const [showMenu, setShowMenu] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const queryClient = useQueryClient();
  const isOwn = userId === currentUserId;
  const { isBlocked } = useBlockedUsers();

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
  });

  const handleEmojiClick = useCallback((type: string) => {
    const userReaction = reactions.find((r) => r.user_id === currentUserId);
    if (userReaction?.reaction_type === type) {
      removeReactionMutation.mutate();
    } else {
      addReactionMutation.mutate(type);
    }
    setShowReactionPicker(false);
  }, [reactions, currentUserId, removeReactionMutation, addReactionMutation]);

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

  // Long press handlers
  const handleLongPressStart = useCallback((e: React.TouchEvent) => {
    touchStartPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    longPressTimer.current = setTimeout(() => {
      setShowMenu(true);
      if (currentUserId) {
        setShowReactionPicker(true);
      }
    }, 600);
  }, [currentUserId]);

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

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    touchStartPos.current = null;
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setShowMenu(true);
  }, []);

  // Cleanup timer on unmount
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
    const handleClickOutside = () => setShowReactionPicker(false);
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showReactionPicker]);

  // Close menu when tapping outside
  useEffect(() => {
    if (!showMenu) return;
    const handleClickOutside = () => setShowMenu(false);
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showMenu]);

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
    <div className={`flex flex-col gap-1 ${isReply ? "ml-8" : ""}`}>
      <div className="flex gap-2">
        <Avatar className="h-6 w-6">
          <AvatarImage src={avatarUrl || undefined} />
          <AvatarFallback className="text-xs">
            {displayName?.[0] || "?"}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <div
            className="select-none"
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
                  · {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
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
            onClose={() => setShowReactionPicker(false)}
          />
          {/* Reaction display */}
          <CommentReactionsDisplay
            reactions={reactions}
            currentUserId={currentUserId}
            onReactionClick={handleEmojiClick}
          />
        </div>
        <div className="flex items-center gap-0.5">
          {/* Three-dot menu - visible on long press */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-6 w-6 transition-opacity ${showMenu ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
              >
                <MoreVertical className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" collisionPadding={16} className="bg-popover border" onCloseAutoFocus={() => setShowMenu(false)}>
              {currentUserId && onReply && (
                <DropdownMenuItem onClick={() => onReply(id, displayName || "Unknown")}>
                  <Reply className="h-3 w-3 mr-2" /> Reply
                </DropdownMenuItem>
              )}
              {isOwn && (
                <>
                  <DropdownMenuItem onClick={() => setIsEditing(true)}>
                    <Pencil className="h-3 w-3 mr-2" /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => deleteMutation.mutate()}
                    className="text-destructive"
                  >
                    <Trash2 className="h-3 w-3 mr-2" /> Delete
                  </DropdownMenuItem>
                </>
              )}
              {!isOwn && (
                <>
                  <DropdownMenuItem onClick={() => setShowReportDialog(true)}>
                    <Flag className="h-3 w-3 mr-2" /> Report Comment
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setShowBlockDialog(true)}
                    className="text-destructive"
                  >
                    <ShieldAlert className="h-3 w-3 mr-2" /> Block User
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
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
    </div>
  );
});

export { REACTION_EMOJIS };
export type { CommentReaction };
