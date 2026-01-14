import { useState, memo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreVertical, Pencil, Trash2, Check, X, Smile, Reply } from "lucide-react";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

interface CommentReactionUsersPopoverProps {
  userIds: string[];
  emoji: string;
  count: number;
  isUserReaction: boolean;
  onClick: () => void;
}

const CommentReactionUsersPopover = memo(function CommentReactionUsersPopover({
  userIds,
  emoji,
  count,
  isUserReaction,
  onClick,
}: CommentReactionUsersPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);

  const { data: users = [] } = useQuery({
    queryKey: ["comment-reaction-users", userIds],
    queryFn: async () => {
      if (userIds.length === 0) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", userIds);
      if (error) throw error;
      return data;
    },
    enabled: isOpen && userIds.length > 0,
  });

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs ${
            isUserReaction
              ? "bg-primary/20 border border-primary/40"
              : "bg-muted/50 hover:bg-muted"
          }`}
        >
          <span>{emoji}</span>
          <span className="text-muted-foreground">{count}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2 bg-popover border" align="start" side="top">
        <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
          <p className="text-xs font-medium text-muted-foreground mb-1">{emoji} Reactions</p>
          {users.map((user) => (
            <p key={user.id} className="text-sm">
              {user.display_name || "Unknown"}
            </p>
          ))}
          {users.length === 0 && (
            <p className="text-sm text-muted-foreground">Loading...</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
});

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
  const [reactionPopoverOpen, setReactionPopoverOpen] = useState(false);
  const queryClient = useQueryClient();
  const isOwn = userId === currentUserId;

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

  const userReaction = reactions.find((r) => r.user_id === currentUserId);

  const reactionCounts = reactions.reduce((acc, r) => {
    acc[r.reaction_type] = (acc[r.reaction_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const addReactionMutation = useMutation({
    mutationFn: async (reactionType: string) => {
      // First remove any existing reaction
      await supabase
        .from("photo_comment_reactions")
        .delete()
        .eq("comment_id", id)
        .eq("user_id", currentUserId!);
      // Then add the new one
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
        // Remove any existing reaction from this user first
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
    // No onSettled - optimistic update handles UI
  });

  const removeReactionMutation = useMutation({
    mutationFn: async () => {
      // Skip delete for temporary IDs - optimistic update handles UI
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
    // No onSettled - optimistic update handles UI
  });

  const handleEmojiClick = (type: string) => {
    if (userReaction?.reaction_type === type) {
      removeReactionMutation.mutate();
    } else {
      // addReactionMutation handles both adding new and switching reactions
      addReactionMutation.mutate(type);
    }
    setReactionPopoverOpen(false);
  };

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

  return (
    <div className={`flex flex-col gap-1 ${isReply ? "ml-8" : ""}`}>
      <div className="flex gap-2 group">
        <Avatar className="h-6 w-6">
          <AvatarImage src={avatarUrl || undefined} />
          <AvatarFallback className="text-xs">
            {displayName?.[0] || "?"}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
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
          {/* Reaction display */}
          {Object.keys(reactionCounts).length > 0 && (
            <div className="flex gap-1 mt-1 flex-wrap">
              {Object.entries(reactionCounts).map(([type, count]) => {
                const emoji = REACTION_EMOJIS.find((e) => e.type === type)?.emoji || "❤️";
                const isUserReaction = userReaction?.reaction_type === type;
                const usersWithReaction = reactions
                  .filter((r) => r.reaction_type === type)
                  .map((r) => r.user_id);
                return (
                  <CommentReactionUsersPopover
                    key={type}
                    userIds={usersWithReaction}
                    emoji={emoji}
                    count={count}
                    isUserReaction={isUserReaction}
                    onClick={() => handleEmojiClick(type)}
                  />
                );
              })}
            </div>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {/* Reply button */}
          {currentUserId && onReply && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => onReply(id, displayName || "Unknown")}
            >
              <Reply className="h-3 w-3" />
            </Button>
          )}
          {/* Add reaction button */}
          {currentUserId && (
            <Popover open={reactionPopoverOpen} onOpenChange={setReactionPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Smile className="h-3 w-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-2" align="end">
                <div className="flex gap-1">
                  {REACTION_EMOJIS.map(({ type, emoji }) => (
                    <button
                      key={type}
                      onClick={() => handleEmojiClick(type)}
                      className={`p-1.5 rounded hover:bg-muted text-lg ${
                        userReaction?.reaction_type === type ? "bg-primary/20" : ""
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
          {isOwn && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <MoreVertical className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-popover border">
                <DropdownMenuItem onClick={() => setIsEditing(true)}>
                  <Pencil className="h-3 w-3 mr-2" /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => deleteMutation.mutate()}
                  className="text-destructive"
                >
                  <Trash2 className="h-3 w-3 mr-2" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </div>
  );
});
