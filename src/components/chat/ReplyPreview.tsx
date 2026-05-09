import { memo, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runWhenChatScrollIdle } from "@/lib/chatScrollActivity";

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
  isOwn: boolean;
}

export const ReplyIndicator = memo(function ReplyIndicator({ replyToMessage, isOwn }: ReplyIndicatorProps) {
  // Track the LAST committed value separately from the prop. If the prop
  // changes from null → object (or vice versa) while the chat is being
  // scrolled, defer the visible commit until scroll has been idle for
  // 250ms. Without this, late `reply_to` hydration during a fast upward
  // flick adds a ~32px pill above the user's bubble and visibly drops the
  // message they're reading.
  const [committed, setCommitted] = useState(replyToMessage ?? null);
  const committedRef = useRef(committed);
  const firstRenderRef = useRef(true);

  const commit = (next: typeof committed) => {
    committedRef.current = next;
    setCommitted(next);
  };

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    const next = replyToMessage ?? null;
    // Cheap structural compare — only height-affecting changes need to
    // wait for idle. Same identity ⇒ no commit.
    const prev = committedRef.current;
    const same =
      (prev === null && next === null) ||
      (prev !== null &&
        next !== null &&
        prev.text === next.text &&
        prev.authorName === next.authorName);
    if (same) return;

    const cancel = runWhenChatScrollIdle(() => commit(next), 250);
    return cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyToMessage?.text, replyToMessage?.authorName]);

  if (!committed) return null;

  return (
    <div className={`text-xs p-2 mb-1 rounded-lg bg-background/50 border-l-2 border-primary/50 max-w-full min-w-0 overflow-hidden ${isOwn ? 'ml-auto' : ''}`}>
      <p className="text-muted-foreground font-medium truncate">
        {committed.authorName || ""}
      </p>
      <p className="text-muted-foreground/70 truncate">{committed.text.replace(/@\[([^\]]+)\]\([^)]+\)/g, '$1')}</p>
    </div>
  );
});
