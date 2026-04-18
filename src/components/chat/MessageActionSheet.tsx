import { useState, useEffect } from "react";
import { Reply, Pencil, Trash2, Flag, ShieldAlert, MoreHorizontal, ChevronLeft, Copy, Link, ExternalLink, ImageIcon, Check, Pin, PinOff } from "lucide-react";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";

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
  hasImage?: boolean;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReport: () => void;
  onBlock: () => void;
  onViewImage?: () => void;
  // Pin support (only set for chats that support pinning)
  canPin?: boolean;
  isPinned?: boolean;
  pinLimitReached?: boolean;
  onPin?: () => void;
  onUnpin?: () => void;
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
  hasImage,
  onReply,
  onEdit,
  onDelete,
  onReport,
  onBlock,
  onViewImage,
  canPin = false,
  isPinned = false,
  pinLimitReached = false,
  onPin,
  onUnpin,
}: MessageActionSheetProps) {
  const [showSafety, setShowSafety] = useState(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  useEffect(() => {
    if (copiedText) {
      const timer = setTimeout(() => setCopiedText(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [copiedText]);

  const actions: MessageAction[] = [];

  if (hasImage && onViewImage) {
    actions.push({
      label: "View Image",
      icon: <ImageIcon className="h-5 w-5" />,
      onClick: onViewImage,
    });
  }

  if (canReply) {
    actions.push({
      label: "Reply",
      icon: <Reply className="h-5 w-5" />,
      onClick: onReply,
    });
  }

  // Pin / Unpin (only when supported by chat type)
  if (canPin) {
    if (isPinned && onUnpin) {
      actions.push({
        label: "Unpin Message",
        icon: <PinOff className="h-5 w-5" />,
        onClick: onUnpin,
      });
    } else if (!isPinned && onPin) {
      actions.push({
        label: pinLimitReached ? "Pin (limit reached)" : "Pin Message",
        icon: <Pin className="h-5 w-5" />,
        onClick: onPin,
      });
    }
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
    const isMessageCopied = copiedText === messageText;
    actions.push({
      label: isMessageCopied ? "Copied!" : "Copy Message",
      icon: isMessageCopied ? <Check className="h-5 w-5 text-primary" /> : <Copy className="h-5 w-5" />,
      onClick: () => {
        navigator.clipboard.writeText(messageText).then(() => {
          setCopiedText(messageText);
        }).catch(() => {
          setCopiedText(null);
        });
      },
    });

    // Extract URLs for link actions
    const urls = extractUrls(messageText);
    if (urls.length > 0) {
      const firstUrl = urls[0];
      const isLinkCopied = copiedText === firstUrl;
      
      // Open Link action
      actions.push({
        label: urls.length > 1 ? "Open Link" : "Open Link",
        icon: <ExternalLink className="h-5 w-5" />,
        onClick: () => {
          const fullUrl = firstUrl.startsWith('http') ? firstUrl : `https://${firstUrl}`;
          safeOpenUrl(fullUrl);
        },
      });

      // Copy Link action
      actions.push({
        label: isLinkCopied ? "Link Copied!" : "Copy Link",
        icon: isLinkCopied ? <Check className="h-5 w-5 text-primary" /> : <Link className="h-5 w-5" />,
        onClick: () => {
          navigator.clipboard.writeText(firstUrl).then(() => {
            setCopiedText(firstUrl);
          }).catch(() => {
            setCopiedText(null);
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
          {copiedText && (
            <div className="mx-6 mt-2 mb-3 p-3 rounded-lg bg-primary/10 border border-primary/20">
              <p className="text-xs text-muted-foreground mb-1">Copied to clipboard:</p>
              <p className="text-sm text-foreground truncate">{copiedText}</p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
