import { useState } from "react";
import { Reply, Pencil, Trash2, Flag, ShieldAlert, MoreHorizontal, ChevronLeft, Copy, Link } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";

interface MessageAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
}

// Extract plain URLs from message text
const extractUrls = (text: string): string[] => {
  const urlRegex = /(?:https?:\/\/|www\.)[^\s\]]+/gi;
  const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  const urls: string[] = [];
  
  let match;
  while ((match = markdownLinkRegex.exec(text)) !== null) {
    urls.push(match[2]);
  }
  while ((match = urlRegex.exec(text)) !== null) {
    // Skip if this URL was already captured as part of a markdown link
    if (!urls.includes(match[0])) {
      urls.push(match[0]);
    }
  }
  return urls;
};

interface MessageActionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isOwn: boolean;
  isAdmin?: boolean;
  canReply: boolean;
  canEdit: boolean;
  canDelete: boolean;
  isSystemMessage?: boolean;
  messageText?: string;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReport: () => void;
  onBlock: () => void;
}

export function MessageActionSheet({
  open,
  onOpenChange,
  isOwn,
  canReply,
  canEdit,
  canDelete,
  isSystemMessage,
  messageText,
  onReply,
  onEdit,
  onDelete,
  onReport,
  onBlock,
}: MessageActionSheetProps) {
  const [showSafety, setShowSafety] = useState(false);

  const actions: MessageAction[] = [];

  if (canReply) {
    actions.push({
      label: "Reply",
      icon: <Reply className="h-5 w-5" />,
      onClick: onReply,
    });
  }

  if (canEdit) {
    actions.push({
      label: "Edit",
      icon: <Pencil className="h-5 w-5" />,
      onClick: onEdit,
    });
  }

  // Copy message text
  if (messageText) {
    actions.push({
      label: "Copy Message",
      icon: <Copy className="h-5 w-5" />,
      onClick: () => {
        navigator.clipboard.writeText(messageText).then(() => {
          toast.success("Message copied");
        }).catch(() => {
          toast.error("Failed to copy");
        });
      },
    });

    // Copy link if message contains URLs
    const urls = extractUrls(messageText);
    if (urls.length === 1) {
      actions.push({
        label: "Copy Link",
        icon: <Link className="h-5 w-5" />,
        onClick: () => {
          navigator.clipboard.writeText(urls[0]).then(() => {
            toast.success("Link copied");
          }).catch(() => {
            toast.error("Failed to copy");
          });
        },
      });
    } else if (urls.length > 1) {
      // Copy first link, user can copy message for all
      actions.push({
        label: "Copy Link",
        icon: <Link className="h-5 w-5" />,
        onClick: () => {
          navigator.clipboard.writeText(urls[0]).then(() => {
            toast.success("Link copied");
          }).catch(() => {
            toast.error("Failed to copy");
          });
        },
      });
    }
  }

  if (canDelete) {
    actions.push({
      label: "Delete",
      icon: <Trash2 className="h-5 w-5" />,
      onClick: onDelete,
      destructive: true,
    });
  }

  const hasSafetyActions = !isOwn && !isSystemMessage;

  if (actions.length === 0 && !hasSafetyActions) return null;

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) setShowSafety(false);
    onOpenChange(isOpen);
  };

  const renderAction = (action: MessageAction, i: number) => (
    <button
      key={i}
      className={`w-full flex items-center gap-4 px-6 py-3.5 text-left text-[15px] font-medium active:bg-muted transition-colors ${
        action.destructive
          ? "text-destructive"
          : "text-foreground"
      }`}
      onClick={() => {
        handleOpenChange(false);
        requestAnimationFrame(() => action.onClick());
      }}
    >
      {action.icon}
      {action.label}
    </button>
  );

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton
        hideOverlay
        enableDragToClose
        className="px-0 pt-0 pb-0 rounded-t-2xl bg-muted/95 dark:bg-background/95 backdrop-blur-sm border-t-0"
        style={{ zIndex: 100002 }}
      >
        <SheetTitle className="sr-only">Message Actions</SheetTitle>
        <div className="py-2">
          {!showSafety ? (
            <>
              {actions.map(renderAction)}
              {hasSafetyActions && (
                <>
                  {actions.length > 0 && (
                    <div className="my-1 mx-6 border-t border-border/30" />
                  )}
                  <button
                    className="w-full flex items-center gap-4 px-6 py-3.5 text-left text-[15px] font-medium text-muted-foreground active:bg-muted transition-colors"
                    onClick={() => setShowSafety(true)}
                  >
                    <MoreHorizontal className="h-5 w-5" />
                    More…
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <button
                className="w-full flex items-center gap-4 px-6 py-3.5 text-left text-[15px] font-medium text-muted-foreground active:bg-muted transition-colors"
                onClick={() => setShowSafety(false)}
              >
                <ChevronLeft className="h-5 w-5" />
                Back
              </button>
              <div className="my-1 mx-6 border-t border-border/30" />
              <button
                className="w-full flex items-center gap-4 px-6 py-3.5 text-left text-[15px] font-medium text-muted-foreground active:bg-muted transition-colors"
                onClick={() => {
                  handleOpenChange(false);
                  requestAnimationFrame(() => onReport());
                }}
              >
                <Flag className="h-5 w-5" />
                Report Message
              </button>
              <button
                className="w-full flex items-center gap-4 px-6 py-3.5 text-left text-[15px] font-medium text-muted-foreground active:bg-muted transition-colors"
                onClick={() => {
                  handleOpenChange(false);
                  requestAnimationFrame(() => onBlock());
                }}
              >
                <ShieldAlert className="h-5 w-5" />
                Block User
              </button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
