import { memo } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ReplyPreviewProps {
  replyingTo: {
    id: string;
    text: string;
    authorName: string | null;
  } | null;
  onCancel: () => void;
}

export const ReplyPreview = memo(function ReplyPreview({ replyingTo, onCancel }: ReplyPreviewProps) {
  if (!replyingTo) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-2 mb-2 bg-muted rounded-lg border-l-4 border-primary">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-primary font-semibold">
          Replying to {replyingTo.authorName || "message"}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {replyingTo.text.replace(/@\[([^\]]+)\]\([^)]+\)/g, '$1')}
        </p>
      </div>
      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 hover:bg-destructive/10" onClick={onCancel}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
});

interface ReplyIndicatorProps {
  replyToMessage?: {
    text: string;
    authorName: string | null;
  } | null;
  hasReply?: boolean;
  isOwn: boolean;
}

/**
 * Fixed-height reply pill. As soon as `hasReply` is true we reserve a row
 * (h-[42px]) and commit content immediately when it arrives. No deferred
 * hydration — content drops into space that's already accounted for, so
 * Virtuoso never sees a row grow above the user's read anchor during scroll.
 */
export const ReplyIndicator = memo(function ReplyIndicator({ replyToMessage, hasReply = false, isOwn }: ReplyIndicatorProps) {
  const shouldReserve = hasReply || !!replyToMessage;
  if (!shouldReserve) return null;
  const hidden = !replyToMessage;

  return (
    <div
      className={`text-xs p-2 mb-1 h-[42px] rounded-lg bg-background/50 border-l-2 border-primary/50 max-w-full min-w-0 overflow-hidden ${hidden ? 'invisible' : ''} ${isOwn ? 'ml-auto' : ''}`}
      aria-hidden={hidden || undefined}
    >
      <p className="text-muted-foreground font-medium truncate">
        {replyToMessage?.authorName || "\u00A0"}
      </p>
      <p className="text-muted-foreground/70 truncate">
        {replyToMessage?.text.replace(/@\[([^\]]+)\]\([^)]+\)/g, '$1') || "\u00A0"}
      </p>
    </div>
  );
});
