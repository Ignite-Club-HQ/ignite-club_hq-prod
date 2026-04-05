import { useState, useRef, useEffect, useCallback } from "react";
import { Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { PhotoComment } from "@/components/PhotoComment";
import { CommentRepliesThread } from "@/components/CommentRepliesThread";

interface CommentData {
  id: string;
  text: string;
  user_id: string;
  reply_to_id?: string | null;
  created_at: string;
  profiles?: {
    display_name?: string | null;
    avatar_url?: string | null;
  };
}

interface MediaCommentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photoUrl: string;
  uploaderName: string | null;
  uploaderAvatar?: string | null;
  comments: CommentData[];
  commentInput: string;
  onCommentInputChange: (value: string) => void;
  onSubmitComment: () => void;
  isPending?: boolean;
  replyingTo?: { id: string; name: string } | null;
  onSetReplyingTo: (reply: { id: string; name: string } | undefined) => void;
  currentUserId?: string;
}

export function MediaCommentSheet({
  open,
  onOpenChange,
  photoUrl,
  uploaderName,
  uploaderAvatar,
  comments,
  commentInput,
  onCommentInputChange,
  onSubmitComment,
  isPending,
  replyingTo,
  onSetReplyingTo,
  currentUserId,
}: MediaCommentSheetProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 100) + "px";
  }, [commentInput]);

  // Focus input when sheet opens
  useEffect(() => {
    if (open) {
      setTimeout(() => textareaRef.current?.focus(), 400);
    }
  }, [open]);

  // Scroll to bottom when new comments appear
  useEffect(() => {
    if (open && scrollEndRef.current) {
      scrollEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [comments.length, open]);

  const handleSubmit = useCallback(() => {
    if (!commentInput.trim()) return;
    onSubmitComment();
  }, [commentInput, onSubmitComment]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const hasText = commentInput.trim().length > 0;

  const topLevelComments = comments.filter(c => !c.reply_to_id);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[85vh] max-h-[85vh] rounded-t-2xl p-0 flex flex-col"
        enableDragToClose
        dragCloseThreshold={80}
        hideCloseButton
      >
        {/* Drag handle is rendered by SheetContent via enableDragToClose */}

        {/* Header with post context */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border flex-shrink-0">
          <SheetTitle className="sr-only">Comments</SheetTitle>
          <img
            src={photoUrl}
            alt=""
            className="h-10 w-10 rounded-lg object-cover flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{uploaderName || "Unknown"}</p>
            <p className="text-xs text-muted-foreground">Comments</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-shrink-0"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Comment list */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-4 py-3 space-y-3">
            {topLevelComments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <p className="text-sm">No comments yet</p>
                <p className="text-xs mt-1">Be the first to comment</p>
              </div>
            ) : (
              topLevelComments.map((comment) => {
                const replies = comments.filter(c => c.reply_to_id === comment.id);
                return (
                  <div key={comment.id}>
                    <PhotoComment
                      id={comment.id}
                      text={comment.text}
                      userId={comment.user_id}
                      displayName={comment.profiles?.display_name}
                      avatarUrl={comment.profiles?.avatar_url}
                      currentUserId={currentUserId}
                      createdAt={comment.created_at}
                      onReply={(commentId, name) => {
                        onSetReplyingTo({ id: commentId, name });
                        setTimeout(() => textareaRef.current?.focus(), 100);
                      }}
                    />
                    <CommentRepliesThread
                      replies={replies}
                      parentDisplayName={comment.profiles?.display_name}
                      currentUserId={currentUserId}
                      onReply={(commentId, name) => {
                        onSetReplyingTo({ id: commentId, name });
                        setTimeout(() => textareaRef.current?.focus(), 100);
                      }}
                    />
                  </div>
                );
              })
            )}
            <div ref={scrollEndRef} />
          </div>
        </ScrollArea>

        {/* Input bar - sticky at bottom */}
        <div className="flex-shrink-0 border-t border-border bg-background" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          {/* Reply indicator */}
          {replyingTo && (
            <div className="flex items-center gap-2 px-4 py-1.5 bg-muted/30 border-b border-border">
              <span className="text-xs text-muted-foreground truncate flex-1">
                Replying to {replyingTo.name}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0"
                onClick={() => onSetReplyingTo(undefined)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}

          <div className="flex items-end gap-2 px-4 py-2">
            <textarea
              ref={textareaRef}
              value={commentInput}
              onChange={(e) => onCommentInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={replyingTo ? `Reply to ${replyingTo.name}…` : "Write a comment…"}
              rows={1}
              className="flex-1 resize-none bg-muted/50 rounded-xl text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[36px] max-h-[100px] px-3 py-2"
            />
            {hasText && (
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={isPending}
                className="h-9 w-9 p-0 flex-shrink-0 rounded-full"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
