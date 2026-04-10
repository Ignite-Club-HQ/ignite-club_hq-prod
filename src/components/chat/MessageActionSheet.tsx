import { useState } from "react";
import { Reply, Pencil, Trash2, Flag, ShieldAlert, MoreHorizontal, ChevronLeft, Copy, Link } from "lucide-react";
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

interface MessageActionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isOwn: boolean;
  isAdmin?: boolean;
  canReply: boolean;
  canEdit: boolean;
  canDelete: boolean;
  isSystemMessage?: boolean;
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
