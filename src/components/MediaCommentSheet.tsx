import { useState, useRef, useEffect, useCallback } from "react";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { Send, X, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PhotoComment } from "@/components/PhotoComment";
import { CommentRepliesThread } from "@/components/CommentRepliesThread";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";
import { useIOSOverlayScrollLock } from "@/hooks/useIOSOverlayScrollLock";
import { useSignedPhotoUrl } from "@/hooks/useSignedPhotoUrl";

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
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [isCommentInteracting, setIsCommentInteracting] = useState(false);
  const [isReactionGestureActive, setIsReactionGestureActive] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [imgError, setImgError] = useState(false);
  const capacitorPlatform = Capacitor.getPlatform();
  const isNativeIOS = Capacitor.isNativePlatform() && capacitorPlatform === "ios";
  const isIOS = (() => {
    if (typeof navigator === "undefined") return isNativeIOS;
    const userAgent = navigator.userAgent;
    const isIOSDevice = /iPad|iPhone|iPod/.test(userAgent);
    const isIpadDesktopMode = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    return isNativeIOS || isIOSDevice || isIpadDesktopMode;
  })();
  const isKeyboardOpen = useKeyboardOpen();
  const [nativeKeyboardHeight, setNativeKeyboardHeight] = useState(0);
  const [browserKeyboardInset, setBrowserKeyboardInset] = useState(0);
  const { signedUrl: resolvedPhotoUrl, isLoading: isPhotoUrlLoading } = useSignedPhotoUrl(photoUrl);
  const previewPhotoUrl = resolvedPhotoUrl || photoUrl;

  useIOSOverlayScrollLock(open);

  useEffect(() => {
    setImgError(false);
  }, [previewPhotoUrl]);

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

  useEffect(() => {
    if (!isNativeIOS) return;

    Keyboard.setScroll({ isDisabled: open }).catch(() => {
      // Ignore unsupported environments
    });

    return () => {
      Keyboard.setScroll({ isDisabled: false }).catch(() => {
        // Ignore unsupported environments
      });
    };
  }, [isNativeIOS, open]);

  useEffect(() => {
    if (!isIOS || isNativeIOS || !open) {
      setBrowserKeyboardInset(0);
      return;
    }

    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const stableViewportHeight = Number.parseFloat(
        window.getComputedStyle(document.documentElement).getPropertyValue("--stable-vh") || "0",
      ) || window.innerHeight || 0;
      const overlap = Math.max(0, stableViewportHeight - vv.height - vv.offsetTop);
      setBrowserKeyboardInset(overlap > 80 ? Math.round(overlap) : 0);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);

    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [isIOS, isNativeIOS, open]);

  const getCommentViewport = useCallback(() => {
    const scrollRoot = scrollAreaRef.current;
    if (!scrollRoot) return null;

    return (scrollRoot.querySelector("[data-radix-scroll-area-viewport]") as HTMLDivElement | null)
      ?? (scrollRoot.firstElementChild as HTMLDivElement | null);
  }, []);

  const scrollCommentsToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const viewport = getCommentViewport();
    if (!viewport) return;

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior,
    });
  }, [getCommentViewport]);

  const stabilizeIOSViewport = useCallback(() => {
    if (!isIOS || typeof window === "undefined" || typeof document === "undefined") return;

    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [isIOS]);

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

  const blurComposer = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    if (document.activeElement === textarea) {
      textarea.blur();
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
    if (!open || isIOS) return;

    const timeoutId = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 400);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [open, isIOS]);

  useEffect(() => {
    if (!open) {
      blurComposer();
      setIsCommentInteracting(false);
      setNativeKeyboardHeight(0);
      setBrowserKeyboardInset(0);
    }
  }, [blurComposer, open]);

  const safeAreaBottom = typeof window !== "undefined"
    ? Number.parseFloat(
        window.getComputedStyle(document.documentElement).getPropertyValue("--safe-area-bottom") || "0",
      ) || 0
    : 0;
  const nativeViewportOverlap = isNativeIOS
    ? Math.max(0, (window.visualViewport?.offsetTop ?? 0) + (window.visualViewport?.height ?? 0) < (window.innerHeight ?? 0)
        ? (window.innerHeight ?? 0) - ((window.visualViewport?.offsetTop ?? 0) + (window.visualViewport?.height ?? 0))
        : 0)
    : 0;
  const keyboardOffset = isNativeIOS
    ? Math.max(nativeKeyboardHeight + safeAreaBottom, nativeViewportOverlap)
    : isIOS
      ? browserKeyboardInset
      : 0;
  const isKeyboardActive = isIOS ? keyboardOffset > 0 : isKeyboardOpen;

  useEffect(() => {
    if (!open || !isIOS || !isKeyboardActive) return;

    const run = () => stabilizeIOSViewport();
    run();

    const frameId = window.requestAnimationFrame(run);
    const timeoutId = window.setTimeout(run, 180);
    const lateTimeoutId = window.setTimeout(run, 360);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
      window.clearTimeout(lateTimeoutId);
    };
  }, [open, isIOS, isKeyboardActive, stabilizeIOSViewport]);

  // Scroll to bottom when new comments appear or keyboard opens
  useEffect(() => {
    if (!open) return;

    const run = (behavior: ScrollBehavior) => scrollCommentsToBottom(behavior);
    const preferredBehavior: ScrollBehavior = isIOS || isKeyboardActive ? "auto" : "smooth";

    run(preferredBehavior);
    const frameId = window.requestAnimationFrame(() => run("auto"));
    const timeoutId = window.setTimeout(() => run("auto"), 140);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [comments.length, open, isKeyboardActive, isIOS, scrollCommentsToBottom]);

  const handleComposerFocus = useCallback(() => {
    if (!isIOS) return;

    stabilizeIOSViewport();
    window.requestAnimationFrame(stabilizeIOSViewport);
    window.setTimeout(stabilizeIOSViewport, 120);
  }, [isIOS, stabilizeIOSViewport]);

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
    blurComposer();
    setIsVisible(false);
    setTimeout(() => onOpenChange(false), isIOS ? 200 : 250);
  }, [blurComposer, isIOS, onOpenChange]);

  if (!open) return null;

  const hasText = commentInput.trim().length > 0;
  const topLevelComments = comments.filter(c => !c.reply_to_id);
  const replyCount = comments.length - topLevelComments.length;
  const composerOffset = isNativeIOS ? nativeKeyboardHeight : 0;
  const thumbnailSizeClass = isKeyboardActive ? "h-12 w-12" : "h-20 w-20";

  return (
    <>
      {/* Dimmed backdrop — tap to close, lets the photo show through */}
      <div
        onClick={handleClose}
        className={`fixed inset-0 z-[60] bg-black/40 transition-opacity duration-200 ${
          isVisible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden="true"
      />
      <div
        className={`fixed left-0 right-0 bottom-0 z-[61] flex flex-col overflow-hidden bg-background rounded-t-2xl shadow-2xl ease-out ${
          isIOS
            ? `transition-opacity duration-200 ${isVisible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`
            : `transition-transform duration-300 ${isVisible ? "translate-y-0" : "translate-y-full"}`
        }`}
        style={{ top: isKeyboardActive ? 0 : '30vh' }}
        data-lock-keyboard-scroll="true"
      >


      {/* Header bar — compact single-line title with inline count */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border/70 flex-shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 flex-shrink-0"
          onClick={handleClose}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <p className="flex-1 min-w-0 text-sm font-semibold truncate">
          Comments <span className="text-muted-foreground font-normal">({comments.length})</span>
        </p>
      </div>

      {/* Sticky image preview — always visible */}
      <div className={`flex-shrink-0 border-b border-border bg-muted/30 transition-all duration-200 ${
        isKeyboardActive ? "h-16" : "h-24"
      }`}>
        <div className="flex items-center gap-3 h-full px-4">
          {isPhotoUrlLoading ? (
            <div
              className={`rounded-lg bg-muted animate-pulse flex-shrink-0 transition-all duration-200 ${thumbnailSizeClass}`}
              aria-hidden="true"
            />
          ) : !imgError && previewPhotoUrl ? (
            <img
              src={previewPhotoUrl}
              alt={uploaderName ? `Photo uploaded by ${uploaderName}` : "Photo preview"}
              onError={() => setImgError(true)}
              className={`rounded-lg object-cover flex-shrink-0 transition-all duration-200 ${thumbnailSizeClass}`}
            />
          ) : (
            <div className={`rounded-lg bg-muted flex items-center justify-center flex-shrink-0 transition-all duration-200 ${thumbnailSizeClass}`}>
              <span className="text-muted-foreground text-xs">📷</span>
            </div>
          )}
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
        ref={scrollAreaRef}
        className="flex-1 min-h-0"
        style={{ pointerEvents: isCommentInteracting ? "none" : "auto" }}
      >
        <div className="px-4 pt-2 pb-4 space-y-3 bg-muted/10">
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
                        textareaRef.current?.focus({ preventScroll: isIOS });
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
                        textareaRef.current?.focus({ preventScroll: isIOS });
                      }, 100);
                    }}
                  />
                </div>
              );
            })
          )}
          <div />
        </div>
      </ScrollArea>

      {/* Composer — pinned at bottom, messenger-style */}
      <div
        className="flex-shrink-0 bg-muted/40 border-t border-border shadow-[0_-1px_3px_rgba(0,0,0,0.06)] transition-[margin] duration-200 ease-out"
        style={{
          marginBottom: composerOffset ? `${composerOffset}px` : undefined,
          paddingBottom: !isKeyboardActive
            ? isIOS
              ? "calc(var(--safe-area-bottom, env(safe-area-inset-bottom, 0px)) + 12px)"
              : "10px"
            : "10px",
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

        <div className="flex items-end gap-3 px-4 pt-2">
          <textarea
            ref={textareaRef}
            value={commentInput}
            onChange={(e) => onCommentInputChange(e.target.value)}
            onFocus={handleComposerFocus}
            onKeyDown={handleKeyDown}
            placeholder={replyingTo ? `Reply to ${replyingTo.name}…` : "Write a comment…"}
            rows={1}
            className={`flex-1 resize-none bg-background rounded-2xl placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[48px] max-h-[120px] px-4 py-3 leading-[1.4] border border-border ${isIOS ? "text-base" : "text-sm"}`}
            style={isIOS ? { fontSize: "16px" } : undefined}
          />
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={isPending || !hasText}
            className="h-10 w-10 p-0 flex-shrink-0 rounded-full mb-1"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
      </div>
    </>

  );
}
