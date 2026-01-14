import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Users, BellOff, ChevronRight, Trash2, Pencil } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import EditGroupDialog from "./EditGroupDialog";
import { formatDistanceToNow } from "date-fns";

interface ChatGroupCardProps {
  group: {
    id: string;
    name: string;
    allowed_roles: string[];
    teams?: { name: string } | null;
    clubs?: { name: string } | null;
    created_by: string;
    club_id: string | null;
    team_id: string | null;
  };
  lastMessage?: {
    text: string;
    author: string;
    created_at: string;
    image_url?: string | null;
  };
  unreadCount: number;
  isMuted: boolean;
  canManage: boolean;
  onDelete: (groupId: string) => void;
  MessagePreviewComponent: React.FC<{
    text?: string;
    imageUrl?: string | null;
    author?: string;
    hasUnread?: boolean;
    fallback: string;
  }>;
}

export default function ChatGroupCard({
  group,
  lastMessage,
  unreadCount,
  isMuted,
  canManage,
  onDelete,
  MessagePreviewComponent,
}: ChatGroupCardProps) {
  const navigate = useNavigate();
  const [showActions, setShowActions] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const hasUnread = unreadCount > 0;

  const roleLabels: Record<string, string> = {
    team_admin: "Team Admins",
    coach: "Coaches",
    parent: "Parents",
    player: "Players",
    club_admin: "Club Admins",
  };
  const rolesText = group.allowed_roles
    .map((r) => roleLabels[r] || r)
    .join(", ");

  const handleTouchStart = useCallback(() => {
    if (!canManage) return;
    longPressTimer.current = setTimeout(() => {
      setShowActions(true);
    }, 500);
  }, [canManage]);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleClick = useCallback(() => {
    if (showActions) {
      setShowActions(false);
      return;
    }
    navigate(`/groups/${group.id}`);
  }, [showActions, navigate, group.id]);

  return (
    <>
      <Card
        className={`hover:border-primary/50 transition-colors cursor-pointer ${hasUnread ? 'border-primary/30' : ''}`}
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onMouseLeave={() => setShowActions(false)}
      >
        <CardContent className="p-4 flex items-center gap-4">
          <div className="relative">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Users className="h-6 w-6 text-primary" />
            </div>
            {hasUnread && (
              <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-destructive border-2 border-background" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className={`truncate ${hasUnread ? 'font-bold' : 'font-semibold'}`}>{group.name}</h3>
              {isMuted && (
                <BellOff className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </div>
            <p className={`text-sm ${hasUnread ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
              <MessagePreviewComponent 
                text={lastMessage?.text} 
                imageUrl={lastMessage?.image_url}
                author={lastMessage?.author}
                hasUnread={hasUnread}
                fallback={`${group.teams?.name || group.clubs?.name} • ${rolesText}`}
              />
            </p>
          </div>
          
          {/* Long-press action buttons */}
          {showActions && canManage && (
            <div 
              className="flex items-center gap-1 animate-in fade-in slide-in-from-right-2 duration-200" 
              onClick={(e) => e.stopPropagation()}
            >
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8"
                onClick={() => setShowEditDialog(true)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
          
          <div className="flex flex-col items-end gap-1 shrink-0">
            {lastMessage?.created_at && (
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(lastMessage.created_at), { addSuffix: true })}
              </span>
            )}
            <div className="flex items-center gap-2">
              {hasUnread && (
                <span className="h-5 min-w-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-xs font-medium flex items-center justify-center">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog - controlled mode */}
      <EditGroupDialog
        group={{
          id: group.id,
          name: group.name,
          allowed_roles: group.allowed_roles as any,
        }}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Chat Group</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{group.name}"? This action cannot be undone and all messages in this group will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onDelete(group.id);
                setShowDeleteDialog(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
