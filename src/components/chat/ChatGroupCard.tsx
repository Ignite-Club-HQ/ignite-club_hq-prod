import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Users, BellOff, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const hasUnread = unreadCount > 0;

  const contextName = group.teams?.name || group.clubs?.name || "";

  const handleClick = useCallback(() => {
    navigate(`/groups/${group.id}`);
  }, [navigate, group.id]);

  return (
    <>
      <Card
        className={`hover:border-primary/50 transition-colors cursor-pointer ${hasUnread ? 'border-primary/30' : ''}`}
        onClick={handleClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); } }}
        tabIndex={0}
        role="link"
        aria-label={`${group.name} chat group${hasUnread ? `, ${unreadCount} unread messages` : ''}${isMuted ? ', muted' : ''}`}
      >
        <CardContent className="p-4 flex items-center gap-4">
          <div className="relative">
            <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center">
              <Users className="h-6 w-6 text-secondary-foreground" aria-hidden="true" />
            </div>
            {hasUnread && (
              <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-destructive border-2 border-background" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className={`truncate ${hasUnread ? 'font-bold' : 'font-semibold'}`}>{group.name}</h3>
              {isMuted && (
                <BellOff className="h-3.5 w-3.5 text-muted-foreground" aria-label="Muted" />
              )}
            </div>
            <p className={`text-sm ${hasUnread ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
              <MessagePreviewComponent 
                text={lastMessage?.text} 
                imageUrl={lastMessage?.image_url}
                author={lastMessage?.author}
                hasUnread={hasUnread}
                fallback={contextName}
              />
            </p>
          </div>
          
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
              {canManage && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => e.stopPropagation()}
                      aria-label="Group actions"
                    >
                      <MoreVertical className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem onClick={() => setShowEditDialog(true)}>
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit Group
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setShowDeleteDialog(true)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Group
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <ChevronRight className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
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
