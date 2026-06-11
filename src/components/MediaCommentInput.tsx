import { useState, useRef, useEffect, useCallback } from "react";
import { Send, X, Smile } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface MediaCommentInputProps {
  photoId: string;
  photoUrl: string;
  uploaderName: string | null;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isPending?: boolean;
  replyingTo?: { id: string; name: string } | null;
  onCancelReply?: () => void;
  onFocus?: () => void;
}

export function MediaCommentInput({
  photoId,
  photoUrl,
  uploaderName,
  value,
  onChange,
  onSubmit,
  isPending,
  replyingTo,
  onCancelReply,
  onFocus,
}: MediaCommentInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 80) + "px";
  }, [value]);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    onFocus?.();
  }, [onFocus]);

  const handleBlur = useCallback(() => {
    // Delay to allow button clicks to register
    setTimeout(() => {
      if (!value.trim()) {
        setIsFocused(false);
      }
    }, 150);
  }, [value]);

  const handleSubmit = useCallback(() => {
    if (!value.trim()) return;
    onSubmit();
    setIsFocused(false);
  }, [value, onSubmit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const hasText = value.trim().length > 0;

  return (
    <div className="border-t border-border">
      {/* Context header - visible when focused */}
      {isFocused && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 border-b border-border">
          <img
            src={photoUrl}
            alt=""
            className="h-6 w-6 rounded object-cover flex-shrink-0"
          />
          <span className="text-xs text-muted-foreground truncate">
            Commenting on {uploaderName || "this post"}'s post
          </span>
        </div>
      )}

      {/* Reply indicator */}
      {replyingTo && (
        <div className="flex items-center gap-2 px-3 py-1 bg-muted/30 border-b border-border">
          <span className="text-xs text-muted-foreground truncate flex-1">
            Replying to {replyingTo.name}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            onClick={onCancelReply}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-2 px-3 py-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={replyingTo ? `Reply to ${replyingTo.name}…` : "Write a comment…"}
          rows={1}
          // Lean on the OS keyboard's native spellcheck/autocorrect — adds the
          // familiar red squiggle under misspellings without any JS dictionary
          // and stays out of the way of mentions/usernames/URLs.
          spellCheck
          autoCorrect="on"
          autoCapitalize="sentences"
          inputMode="text"
          className="flex-1 resize-none bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none min-h-[32px] max-h-[80px] py-1.5"
        />
        {hasText && (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleSubmit}
            disabled={isPending}
            className="h-8 w-8 p-0 flex-shrink-0 text-primary hover:text-primary"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
