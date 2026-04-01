import { Reply, Pencil, Trash2, Flag, ShieldAlert } from "lucide-react";
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

  if (!isOwn && !isSystemMessage) {
    actions.push({
      label: "Report Message",
      icon: <Flag className="h-5 w-5" />,
      onClick: onReport,
    });
    actions.push({
      label: "Block User",
      icon: <ShieldAlert className="h-5 w-5" />,
      onClick: onBlock,
      destructive: true,
    });
  }

  if (actions.length === 0) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton
        enableDragToClose
        className="px-0 pt-0 pb-0 rounded-t-2xl z-[100002]"
        style={{ zIndex: 100002 }}
      >
        <SheetTitle className="sr-only">Message Actions</SheetTitle>
        <div className="py-2">
          {actions.map((action, i) => (
            <button
              key={i}
              className={`w-full flex items-center gap-4 px-6 py-3.5 text-left text-[15px] font-medium active:bg-muted transition-colors ${
                action.destructive
                  ? "text-destructive"
                  : "text-foreground"
              }`}
              onClick={() => {
                onOpenChange(false);
                // Small delay so sheet closes before action fires
                requestAnimationFrame(() => action.onClick());
              }}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
