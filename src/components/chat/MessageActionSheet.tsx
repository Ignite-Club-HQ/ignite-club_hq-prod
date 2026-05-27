import { useState, useEffect } from "react";
import { Reply, Pencil, Trash2, Flag, ShieldAlert, MoreHorizontal, ChevronLeft, Copy, Link, ExternalLink, ImageIcon, Check, Pin, PinOff, ImagePlus, Loader2, Forward } from "lucide-react";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";

interface MessageAction {
  /** Stable identifier independent of localised/transient label text — used as
   *  React key so swapping "Copy Message" → "Copied!" doesn't unmount the row. */
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
}

// Extract plain URLs from message text, including bare domains like example.com
const extractUrls = (text: string): string[] => {
  const urlRegex = /(?:https?:\/\/|www\.)[^\s\]]+/gi;
  const bareDomainRegex = /(?:^|[\s([{<])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|edu|gov|au|co|io|app|dev|club|team|sport|sports|com\.au|org\.au|net\.au)(?::\d{2,5})?(?:\/[^\s\])}>,]*)?)/gi;
  const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  const urls: string[] = [];
  const addUrl = (url: string) => {
    const normalized = url.replace(/[.,!?;:]+$/g, "");
    if (normalized && !urls.includes(normalized)) urls.push(normalized);
  };
  
  let match;
  while ((match = markdownLinkRegex.exec(text)) !== null) {
    addUrl(match[2]);
  }
  while ((match = urlRegex.exec(text)) !== null) {
    addUrl(match[0]);
  }
  while ((match = bareDomainRegex.exec(text)) !== null) {
    addUrl(match[1]);
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
  /** Optional. When provided, a "Forward" action appears in the sheet. */
  canForward?: boolean;
  onForward?: () => void;
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
  // Publish-to-gallery support (only set when poster owns the image
  // and the chat has a known team/club context, e.g. team chat).
  canPublishToGallery?: boolean;
  isPublishedToGallery?: boolean;
  isPublishingToGallery?: boolean;
  onPublishToGallery?: () => void;
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
  canForward = false,
  onForward,
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
  canPublishToGallery = false,
  isPublishedToGallery = false,
  isPublishingToGallery = false,
  onPublishToGallery,
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
      id: "view-image",
      label: "View Image",
      icon: <ImageIcon className="h-5 w-5" />,
      onClick: onViewImage,
    });
  }

  // Publish own chat photo to the team's media gallery.
  // Only meaningful for image messages in a team-context chat where the
  // poster has team-member upload rights.
  if (canPublishToGallery && hasImage && onPublishToGallery) {
    const label = isPublishingToGallery
      ? "Publishing…"
      : isPublishedToGallery
        ? "Published to Gallery"
        : "Publish to Media Gallery";
    actions.push({
      id: "publish-gallery",
      label,
      icon: isPublishingToGallery
        ? <Loader2 className="h-5 w-5 animate-spin" />
        : isPublishedToGallery
          ? <Check className="h-5 w-5 text-primary" />
          : <ImagePlus className="h-5 w-5" />,
      onClick: () => {
        if (isPublishingToGallery || isPublishedToGallery) return;
        onPublishToGallery();
      },
    });
  }

  if (canReply) {
    actions.push({
      id: "reply",
      label: "Reply",
      icon: <Reply className="h-5 w-5" />,
      onClick: onReply,
    });
  }

  if (canForward && onForward) {
    actions.push({
      id: "forward",
      label: "Forward",
      icon: <Forward className="h-5 w-5" />,
      onClick: onForward,
    });
  }

  if (canEdit) {
    actions.push({
      id: "edit",
      label: "Edit",
      icon: <Pencil className="h-5 w-5" />,
      onClick: onEdit,
    });
  }

  // Copy message text
  if (messageText) {
    const isMessageCopied = copiedText === messageText;
    actions.push({
      id: "copy-message",
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
        id: "open-link",
        label: urls.length > 1 ? "Open Link" : "Open Link",
        icon: <ExternalLink className="h-5 w-5" />,
        onClick: () => {
          const fullUrl = firstUrl.startsWith('http') ? firstUrl : `https://${firstUrl}`;
          safeOpenUrl(fullUrl);
        },
      });

      // Copy Link action
      actions.push({
        id: "copy-link",
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

  // Pin / Unpin (only when supported by chat type) — placed after Copy, before Delete
  if (canPin) {
    if (isPinned && onUnpin) {
      actions.push({
        id: "unpin",
        label: "Unpin Message",
        icon: <PinOff className="h-5 w-5" />,
        onClick: onUnpin,
      });
    } else if (!isPinned && onPin) {
      actions.push({
        id: "pin",
        label: pinLimitReached ? "Pin (limit reached)" : "Pin Message",
        icon: <Pin className="h-5 w-5" />,
        onClick: onPin,
      });
    }
  }

  if (canDelete) {
    actions.push({
      id: "delete",
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

  const renderAction = (action: MessageAction) => (
    <button
      key={action.id}
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
