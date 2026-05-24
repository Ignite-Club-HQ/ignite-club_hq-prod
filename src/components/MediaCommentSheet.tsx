import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { Send, X, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PhotoComment } from "@/components/PhotoComment";
import { CommentRepliesThread } from "@/components/CommentRepliesThread";
import { EmojiPicker } from "@/components/chat/EmojiPicker";
import { useIOSOverlayScrollLock } from "@/hooks/useIOSOverlayScrollLock";
import { useNativeKeyboardHeight } from "@/hooks/useNativeKeyboardHeight";
import { useSignedPhotoUrl } from "@/hooks/useSignedPhotoUrl";
import { usePhotoMentionSuggestions, type MentionUser } from "@/hooks/usePhotoMentionSuggestions";

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
  teamName?: string | null;
  /** Audience scope of the post — restricts who can be @mentioned. */
  teamId?: string | null;
  clubId?: string | null;
  miniLeagueId?: string | null;
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
  teamName,
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
  const [browserKbInset, setBrowserKbInset] = useState(0);
  const [webViewportHeight, setWebViewportHeight] = useState<number | null>(null);
  const capacitorPlatform = Capacitor.getPlatform();
  const isNative = Capacitor.isNativePlatform();
  const isNativeIOS = isNative && capacitorPlatform === "ios";
  const isIOS = (() => {
    if (typeof navigator === "undefined") return isNativeIOS;
    const ua = navigator.userAgent;
    const isIOSDevice = /iPad|iPhone|iPod/.test(ua);
    const isIpadDesktop = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    return isNativeIOS || isIOSDevice || isIpadDesktop;
  })();
  const nativeKeyboardHeight = useNativeKeyboardHeight();
  const { signedUrl: resolvedPhotoUrl } = useSignedPhotoUrl(photoUrl);
  const previewPhotoUrl = resolvedPhotoUrl || photoUrl;

  useIOSOverlayScrollLock(open);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const root = document.documentElement;
    const previousValue = root.getAttribute("data-media-comments-open");
    root.setAttribute("data-media-comments-open", "true");
    return () => {
      if (previousValue === null) root.removeAttribute("data-media-comments-open");
      else root.setAttribute("data-media-comments-open", previousValue);
    };
  }, [open]);

  useEffect(() => {
    setImgError(false);
  }, [previewPhotoUrl]);

  // Disable native iOS keyboard scroll (prevents the WebView shifting the whole viewport)
  useEffect(() => {
    if (!isNativeIOS) return;
    Keyboard.setScroll({ isDisabled: open }).catch(() => {});
    return () => {
      Keyboard.setScroll({ isDisabled: false }).catch(() => {});
    };
  }, [isNativeIOS, open]);

  // Web fallback: derive keyboard inset from visualViewport (covers Android mobile web)
  useEffect(() => {
    if (!open || isNative) {
      setBrowserKbInset(0);
      setWebViewportHeight(null);
      return;
    }
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) {
      setWebViewportHeight(typeof window !== "undefined" ? window.innerHeight : null);
      return;
    }

    let baseline = vv.height;
    const update = () => {
      if (vv.height > baseline) baseline = vv.height;
      const overlap = Math.max(0, baseline - vv.height - vv.offsetTop);
      setWebViewportHeight(Math.round(vv.height));
      setBrowserKbInset(overlap > 80 ? Math.round(overlap) : 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [open, isNative]);

  const keyboardInset = isNative ? nativeKeyboardHeight : browserKbInset;
  const isKeyboardActive = keyboardInset > 0;
  const screenHeight = isNative
    ? "var(--stable-vh, 100dvh)"
    : webViewportHeight
      ? `${webViewportHeight}px`
      : "var(--visual-vh, 100dvh)";

  const getCommentViewport = useCallback(() => {
    const root = scrollAreaRef.current;
    if (!root) return null;
    return (root.querySelector("[data-radix-scroll-area-viewport]") as HTMLDivElement | null)
      ?? (root.firstElementChild as HTMLDivElement | null);
  }, []);

  const scrollCommentsToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const viewport = getCommentViewport();
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }, [getCommentViewport]);

  const stabilizeIOSViewport = useCallback(() => {
    if (!isIOS || typeof window === "undefined") return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [isIOS]);

  const restoreInputFocus = useCallback(() => {
    const t = textareaRef.current;
    if (!t) return;
    const s = t.selectionStart ?? t.value.length;
    const e = t.selectionEnd ?? t.value.length;
    t.focus({ preventScroll: true });
    try {
      t.setSelectionRange(s, e);
    } catch {
      // Some mobile browsers reject selection restoration during keyboard transitions.
    }
  }, []);

  const blurComposer = useCallback(() => {
    const t = textareaRef.current;
    if (t && document.activeElement === t) t.blur();
  }, []);

  const handleReactionGestureStateChange = useCallback((active: boolean) => {
    if (!active) { setIsReactionGestureActive(false); return; }
    const t = textareaRef.current;
    if (t && document.activeElement === t) restoreInputFocus();
    setIsReactionGestureActive(true);
  }, [restoreInputFocus]);

  // Animate in
  useEffect(() => {
    if (open) requestAnimationFrame(() => setIsVisible(true));
    else setIsVisible(false);
  }, [open]);

  useEffect(() => {
    if (isCommentInteracting && textareaRef.current) {
      const t = setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 50);
      return () => clearTimeout(t);
    }
  }, [isCommentInteracting]);

  useEffect(() => {
    if (!open || (!isReactionGestureActive && !isCommentInteracting)) return;
    const t = textareaRef.current;
    if (!t || document.activeElement !== t) return;
    const refocus = () => restoreInputFocus();
    refocus();
    const t1 = window.setTimeout(refocus, 0);
    const t2 = window.setTimeout(refocus, 120);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [open, isReactionGestureActive, isCommentInteracting, restoreInputFocus]);

  // Auto-resize textarea
  useEffect(() => {
    const t = textareaRef.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 110) + "px";
  }, [commentInput]);

  useEffect(() => {
    if (!open) {
      blurComposer();
      setIsCommentInteracting(false);
    }
  }, [open, blurComposer]);

  useEffect(() => {
    if (!open || !isIOS || !isKeyboardActive) return;
    const run = () => stabilizeIOSViewport();
    run();
    const f = window.requestAnimationFrame(run);
    const t1 = window.setTimeout(run, 180);
    return () => { window.cancelAnimationFrame(f); window.clearTimeout(t1); };
  }, [open, isIOS, isKeyboardActive, stabilizeIOSViewport]);

  // Scroll to bottom when new comments appear or keyboard opens
  useEffect(() => {
    if (!open) return;
    const behavior: ScrollBehavior = isIOS || isKeyboardActive ? "auto" : "smooth";
    scrollCommentsToBottom(behavior);
    const f = window.requestAnimationFrame(() => scrollCommentsToBottom("auto"));
    const t = window.setTimeout(() => scrollCommentsToBottom("auto"), 140);
    return () => { window.cancelAnimationFrame(f); window.clearTimeout(t); };
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
    setTimeout(() => onOpenChange(false), isIOS ? 180 : 220);
  }, [blurComposer, isIOS, onOpenChange]);

  if (!open) return null;

  const hasText = commentInput.trim().length > 0;
  const topLevelComments = comments.filter(c => !c.reply_to_id);

  const content = (
    <div
      className={`media-comment-screen fixed inset-0 flex flex-col overflow-hidden overscroll-none bg-background ease-out ${
        isIOS
          ? `transition-opacity duration-200 ${isVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`
          : `transition-transform duration-300 ${isVisible ? "translate-y-0" : "translate-y-full"}`
      }`}
      style={{
        zIndex: 2147483647,
        width: "100vw",
        height: screenHeight,
        maxHeight: screenHeight,
        minHeight: 0,
        transform: isIOS ? "translate3d(0,0,0)" : undefined,
      }}
      data-lock-keyboard-scroll="true"
      role="dialog"
      aria-modal="true"
      aria-label="Comments"
    >
      {/* Safe-area top spacer */}
      <div
        className="flex-shrink-0 bg-background"
        style={{ height: "var(--safe-area-top, env(safe-area-inset-top, 0px))" }}
      />

      {/* Compact sticky media context header */}
      <header className="flex items-center gap-3 px-2 py-2 border-b border-border/60 flex-shrink-0 bg-background">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 flex-shrink-0"
          onClick={handleClose}
          aria-label="Close comments"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>

        {!imgError && previewPhotoUrl ? (
          <img
            src={previewPhotoUrl}
            alt=""
            onError={() => setImgError(true)}
            className="h-10 w-10 rounded-md object-cover flex-shrink-0 bg-muted"
          />
        ) : (
          <div className="h-10 w-10 rounded-md bg-muted flex-shrink-0" />
        )}

        <div className="flex flex-col min-w-0 flex-1 leading-tight">
          <span className="text-[14px] font-semibold truncate">
            {uploaderName || "Photo"}
          </span>
          <span className="text-[12px] text-muted-foreground truncate">
            {teamName ? `${teamName} · ` : ""}{comments.length} {comments.length === 1 ? "comment" : "comments"}
          </span>
        </div>
      </header>

      {/* Comment list — fills remaining space */}
      <ScrollArea
        ref={scrollAreaRef}
        className="flex-1 min-h-0"
        style={{ pointerEvents: isCommentInteracting ? "none" : "auto" }}
      >
        {topLevelComments.length === 0 ? (
          <div className="px-4 pt-8 pb-4 text-center">
            <p className="text-sm font-medium text-foreground">No comments yet</p>
            <p className="text-xs text-muted-foreground mt-1">Be the first to comment</p>
          </div>
        ) : (
          <div className="px-4 pt-3 pb-4 space-y-3">
            {topLevelComments.map((comment) => {
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
                      window.setTimeout(() => textareaRef.current?.focus({ preventScroll: isIOS }), 100);
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
                      window.setTimeout(() => textareaRef.current?.focus({ preventScroll: isIOS }), 100);
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* Composer — slim pill, docked above keyboard */}
      <div
        className="flex-shrink-0 bg-background border-t border-border/60 transition-[padding] duration-150 ease-out"
        style={{
          paddingBottom: isNative && isKeyboardActive
            ? `${keyboardInset + 6}px`
            : "calc(var(--safe-area-bottom, env(safe-area-inset-bottom, 0px)) + 8px)",
        }}
      >
        {replyingTo && (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-muted/40 border-b border-border/60">
            <span className="text-xs text-muted-foreground truncate flex-1">
              Replying to <span className="text-foreground font-medium">{replyingTo.name}</span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => onSetReplyingTo(undefined)}
              aria-label="Cancel reply"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        <div className="px-3 pt-2">
          <div className="relative flex items-end bg-muted/60 rounded-full focus-within:bg-muted/80 transition-colors">
            <textarea
              ref={textareaRef}
              value={commentInput}
              onChange={(e) => onCommentInputChange(e.target.value)}
              onFocus={handleComposerFocus}
              onKeyDown={handleKeyDown}
              placeholder={replyingTo ? `Reply to ${replyingTo.name}…` : "Add a comment…"}
              rows={1}
              className={`flex-1 resize-none bg-transparent placeholder:text-muted-foreground focus:outline-none min-h-[40px] max-h-[110px] pl-4 pr-11 py-2.5 leading-[1.3] ${isIOS ? "text-base" : "text-[15px]"}`}
              style={isIOS ? { fontSize: "16px" } : undefined}
            />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending || !hasText}
              className={`absolute right-1 bottom-1 h-8 w-8 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity ${
                hasText ? "opacity-100" : "opacity-40 pointer-events-none"
              }`}
              aria-label="Send comment"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return content;
  return createPortal(content, document.body);
}
