import { FolderOpen, ChevronRight, Share2, Pencil, Trash2, MoreVertical, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SwipeableRow } from "@/components/ui/swipeable-row";

interface VaultFolderCardProps {
  folder: { id: string; name: string };
  onNavigate: () => void;
  onShare?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onExport?: () => void;
  canEdit?: boolean;
}

export function VaultFolderCard({
  folder,
  onNavigate,
  onShare,
  onRename,
  onDelete,
  onExport,
  canEdit = false,
}: VaultFolderCardProps) {
  const hasMenuActions = onShare || onExport;
  
  // Build swipe actions for edit/delete
  const swipeActions = [];
  if (canEdit && onRename) {
    swipeActions.push({
      label: "Rename",
      icon: <Pencil className="h-4 w-4" />,
      onClick: onRename,
      className: "bg-blue-500 text-white",
    });
  }
  if (canEdit && onDelete) {
    swipeActions.push({
      label: "Delete",
      icon: <Trash2 className="h-4 w-4" />,
      onClick: onDelete,
      className: "bg-destructive text-destructive-foreground",
    });
  }

  const cardContent = (
    <Card
      className="cursor-pointer hover:bg-accent/50 transition-colors group"
      onClick={onNavigate}
      role="link"
      aria-label={`Open folder ${folder.name}`}
    >
      <CardContent className="p-4 flex items-center gap-3">
        <div className="flex items-center gap-3 flex-1">
          <div className="p-2 rounded-lg bg-primary/10">
            <FolderOpen className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
          <p className="font-medium">{folder.name}</p>
        </div>
        
        {/* Three-dot menu only for non-edit actions (Share, Export) */}
        {hasMenuActions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover">
              {onExport && (
                <DropdownMenuItem onClick={(e) => {
                  e.stopPropagation();
                  onExport();
                }}>
                  <Download className="h-4 w-4 mr-2" />
                  Export Folder
                </DropdownMenuItem>
              )}
              {onShare && (
                <DropdownMenuItem onClick={(e) => {
                  e.stopPropagation();
                  onShare();
                }}>
                  <Share2 className="h-4 w-4 mr-2" />
                  Share
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        
        <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </CardContent>
    </Card>
  );

  if (swipeActions.length > 0) {
    return (
      <SwipeableRow
        enabled={canEdit}
        actions={swipeActions}
        actionsWidth={swipeActions.length * 70}
      >
        {cardContent}
      </SwipeableRow>
    );
  }

  return cardContent;
}
