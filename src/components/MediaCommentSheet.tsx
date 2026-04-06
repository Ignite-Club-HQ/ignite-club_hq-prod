import { useState, useRef, useEffect, useCallback } from "react";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { Send, X, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PhotoComment } from "@/components/PhotoComment";
import { CommentRepliesThread } from "@/components/CommentRepliesThread";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";
import { useIOSScrollLock } from "@/hooks/useIOSScrollLock";

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
  const [isCommentInteracting, setIsCommentInteracting] = useState(false);
  const [isReactionGestureActive, setIsReactionGestureActive] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  const isKeyboardOpen = useKeyboardOpen();
  const [nativeKeyboardHeight, setNativeKeyboardHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);

  useIOSScrollLock(open);

  // Non-iOS keeps the existing viewport-sized sheet behavior.
  useEffect(() => {
    if (isNativeIOS) {
      setViewportHeight(null);
      return;
    }

    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setViewportHeight(vv.height);
    update();
    vv.addEventListener("resize", update);
    return () => vv.removeEventListener("resize", update);
  }, [isNativeIOS]);

  useEffect(() => {
    if (!isNativeIOS || !open) {
      setNativeKeyboardHeight(0);
      return;
    }

    let keyboardShowListener: { remove: () => void } | undefined;
    let keyboardHideListener: { remove: () => void } | undefined;

    Keyboard.addListener("keyboardDidShow", ({ keyboardHeight }) => {
      setNativeKeyboardHeight(keyboardHeight || 0);
    }).then((handle) => {
      keyboardShowListener = handle;
    });

    Keyboard.addListener("keyboardDidHide", () => {
      setNativeKeyboardHeight(0);
    }).then((handle) => {
      keyboardHideListener = handle;
    });

    return () => {
      keyboardShowListener?.remove();
      keyboardHideListener?.remove();
    };
  }, [isNativeIOS, open]);

  const restoreInputFocus = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const selectionStart = textarea.selectionStart ?? textarea.value.length;
    const selectionEnd = textarea.selectionEnd ?? textarea.value.length;
    textarea.focus({ preventScroll: true });
    try {
      textarea.setSelectionRange(selectionStart, selectionEnd);
    } catch {
      // Ignore
    }
  }, []);

  const handleReactionGestureStateChange = useCallback((active: boolean) => {
    if (!active) {
      setIsReactionGestureActive(false);
      return;
    }
    const textarea = textareaRef.current;
    const isTyping = textarea && document.activeElement === textarea;
    if (isTyping) {
      restoreInputFocus();
    }
    setIsReactionGestureActive(true);
  }, [restoreInputFocus]);

  // Animate in
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => setIsVisible(true));
    } else {
      setIsVisible(false);
    }
  }, [open]);

  // Re-focus textarea when reaction picker opens while typing
  useEffect(() => {
    if (isCommentInteracting && textareaRef.current) {
      const t = setTimeout(() => {
        textareaRef.current?.focus({ preventScroll: true });
      }, 50);
      return () => clearTimeout(t);
    }
  }, [isCommentInteracting]);

  // Refocus only when already typing
  useEffect(() => {
    if (!open || (!isReactionGestureActive && !isCommentInteracting)) return;
    const textarea = textareaRef.current;
    if (!textarea || document.activeElement !== textarea) return;
    const refocus = () => restoreInputFocus();
    refocus();
    const t1 = window.setTimeout(refocus, 0);
    const t2 = window.setTimeout(refocus, 120);
    const t3 = window.setTimeout(refocus, 260);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [open, isReactionGestureActive, isCommentInteracting, restoreInputFocus]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
  }, [commentInput]);

  // Focus input when sheet opens
  useEffect(() => {
    if (!open || isNativeIOS) return;

    const timeoutId = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 400);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [open, isNativeIOS]);

  useEffect(() => {
    if (!open) {
      setIsCommentInteracting(false);
      setNativeKeyboardHeight(0);
    }
  }, [open]);

  // Scroll to bottom when new comments appear or keyboard opens
  useEffect(() => {
    if (open && scrollEndRef.current) {
      scrollEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [comments.length, open, isKeyboardOpen]);

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

  const handleClose = useCallback(() => {
    setIsVisible(false);
    setTimeout(() => onOpenChange(false), 250);
  }, [onOpenChange]);

  if (!open) return null;

  const hasText = commentInput.trim().length > 0;
  const topLevelComments = comments.filter(c => !c.reply_to_id);
  const replyCount = comments.length - topLevelComments.length;
  const sheetHeight = isNativeIOS
    ? "var(--stable-vh, 100dvh)"
    : viewportHeight
      ? `${viewportHeight}px`
      : "var(--stable-vh, 100dvh)";
  const composerOffset = isNativeIOS ? nativeKeyboardHeight : 0;

  return (
    <div
      className={`fixed left-0 right-0 top-0 z-[61] flex flex-col bg-background transition-transform duration-300 ease-out ${
        isVisible ? "translate-y-0" : "translate-y-full"
      }`}
      style={{
        height: sheetHeight,
      }}
      data-lock-keyboard-scroll="true"
    >
      {/* Safe-area spacer — pushes content below status bar / Dynamic Island */}
      <div
        className="flex-shrink-0 bg-background"
        style={{ height: 'var(--safe-area-top, env(safe-area-inset-top, 0px))' }}
      />

      {/* Header bar — visually clean, vertically centered like iOS system apps */}
      <div className="flex items-center gap-2 px-2 py-2.5 border-b border-border flex-shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 flex-shrink-0"
          onClick={handleClose}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">Comments</p>
          <p className="text-[11px] text-muted-foreground leading-tight">
            {comments.length} {comments.length === 1 ? "comment" : "comments"}
          </p>
        </div>
      </div>

      {/* Sticky image preview — always visible */}
      <div className={`flex-shrink-0 border-b border-border bg-muted/30 transition-all duration-200 ${
        isKeyboardOpen ? "h-16" : "h-24"
      }`}>
        <div className="flex items-center gap-3 h-full px-4">
          <img
            src={photoUrl}
            alt=""
            className={`rounded-lg object-cover flex-shrink-0 transition-all duration-200 ${
              isKeyboardOpen ? "h-12 w-12" : "h-20 w-20"
            }`}
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground truncate">
              {uploaderName || "Unknown"}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {topLevelComments.length} {topLevelComments.length === 1 ? "thread" : "threads"} · {replyCount} {replyCount === 1 ? "reply" : "replies"}
            </p>
          </div>
        </div>
      </div>

      {/* Comment list — fills remaining space, with bottom padding so last comment
           is never hidden behind the composer */}
      <ScrollArea
        className="flex-1 min-h-0"
        style={{ pointerEvents: isCommentInteracting ? "none" : "auto" }}
      >
        <div className="px-4 pt-3 pb-4 space-y-3">
          {topLevelComments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
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
                    onInteractionChange={setIsCommentInteracting}
                    onLongPressGestureStateChange={handleReactionGestureStateChange}
                    onReply={(commentId, name) => {
                      onSetReplyingTo({ id: commentId, name });
                      window.setTimeout(() => {
                        textareaRef.current?.focus({ preventScroll: isNativeIOS });
                      }, 100);
                    }}
                  />
                  <CommentRepliesThread
                    replies={replies}
                    parentDisplayName={comment.profiles?.display_name}
                    currentUserId={currentUserId}
                    onInteractionChange={setIsCommentInteracting}
                    onLongPressGestureStateChange={handleReactionGestureStateChange}
                    onReply={(commentId, name) => {
                      onSetReplyingTo({ id: commentId, name });
                      window.setTimeout(() => {
                        textareaRef.current?.focus({ preventScroll: isNativeIOS });
                      }, 100);
                    }}
                  />
                </div>
              );
            })
          )}
          <div ref={scrollEndRef} />
        </div>
      </ScrollArea>

      {/* Composer — pinned at bottom above home indicator */}
      <div
        className="flex-shrink-0 border-t border-border bg-background transition-[margin] duration-200 ease-out"
        style={{
          marginBottom: composerOffset ? `${composerOffset}px` : undefined,
          paddingBottom: isKeyboardOpen ? '0px' : 'var(--safe-area-bottom, env(safe-area-inset-bottom, 0px))',
        }}
      >
        {/* Reply indicator */}
        {replyingTo && (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-muted/30 border-b border-border">
            <span className="text-xs text-muted-foreground truncate flex-1">
              Replying to {replyingTo.name}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => onSetReplyingTo(undefined)}
            >
              <X className="h-3.5 w-3.5" />
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
            className="flex-1 resize-none bg-muted/50 rounded-2xl text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[40px] max-h-[100px] px-4 py-2.5 leading-[1.4]"
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
    </div>
  );
}
