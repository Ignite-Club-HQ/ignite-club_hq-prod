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
          Replying to {replyingTo.authorName || "..."}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {replyingTo.text}
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
  isOwn: boolean;
}

export const ReplyIndicator = memo(function ReplyIndicator({ replyToMessage, isOwn }: ReplyIndicatorProps) {
  if (!replyToMessage) return null;

  return (
    <div className={`text-xs p-2 mb-1 rounded-lg bg-background/50 border-l-2 border-primary/50 ${isOwn ? 'ml-auto' : ''}`}>
      <p className="text-muted-foreground font-medium truncate">
        {replyToMessage.authorName || "..."}
      </p>
      <p className="text-muted-foreground/70 truncate">{replyToMessage.text}</p>
    </div>
  );
});
