import { useState, useRef, useCallback } from "react";
import { FolderOpen, ChevronRight, Share2, Pencil, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface VaultFolderCardProps {
  folder: { id: string; name: string };
  onNavigate: () => void;
  onShare?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  canEdit?: boolean;
}

export function VaultFolderCard({
  folder,
  onNavigate,
  onShare,
  onRename,
  onDelete,
  canEdit = false,
}: VaultFolderCardProps) {
  const [showActions, setShowActions] = useState(false);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const isLongPress = useRef(false);

  const handleTouchStart = useCallback(() => {
    isLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      setShowActions(true);
    }, 500); // 500ms long press
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    // If it wasn't a long press, navigate
    if (!isLongPress.current && !showActions) {
      onNavigate();
    }
  }, [onNavigate, showActions]);

  const handleTouchMove = useCallback(() => {
    // Cancel long press if user moves finger
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    // On desktop, just navigate (actions show on hover)
    if (!showActions) {
      onNavigate();
    }
  }, [onNavigate, showActions]);

  const handleActionClick = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation();
    action();
    setShowActions(false);
  };

  const handleCloseActions = () => {
    setShowActions(false);
  };

  return (
    <Card
      className="cursor-pointer hover:bg-accent/50 transition-colors group"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      onClick={handleClick}
    >
      <CardContent className="p-4 flex items-center gap-3">
        <div className="flex items-center gap-3 flex-1">
          <div className="p-2 rounded-lg bg-primary/10">
            <FolderOpen className="h-5 w-5 text-primary" />
          </div>
          <p className="font-medium">{folder.name}</p>
        </div>
        
        {/* Actions shown after long press on mobile */}
        {showActions && (
          <div className="flex items-center gap-1">
            {onShare && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={(e) => handleActionClick(e, onShare)}
              >
                <Share2 className="h-4 w-4" />
              </Button>
            )}
            {canEdit && onRename && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={(e) => handleActionClick(e, onRename)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {canEdit && onDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={(e) => handleActionClick(e, onDelete)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={(e) => {
                e.stopPropagation();
                handleCloseActions();
              }}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
        
        {/* Desktop hover actions */}
        {!showActions && (
          <>
            {onShare && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground hidden md:flex"
                onClick={(e) => handleActionClick(e, onShare)}
              >
                <Share2 className="h-4 w-4" />
              </Button>
            )}
            {canEdit && onRename && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground hidden md:flex"
                onClick={(e) => handleActionClick(e, onRename)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {canEdit && onDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hidden md:flex"
                onClick={(e) => handleActionClick(e, onDelete)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </>
        )}
      </CardContent>
    </Card>
  );
}
