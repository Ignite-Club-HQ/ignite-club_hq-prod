import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Users, BellOff, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatTimeShort } from "@/lib/formatTimeShort";

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
  MessagePreviewComponent,
}: ChatGroupCardProps) {
  const navigate = useNavigate();
  const hasUnread = unreadCount > 0;

  const handleClick = useCallback(() => {
    navigate(`/groups/${group.id}`);
  }, [navigate, group.id]);

  return (
    <Card
      className={`hover:border-primary/50 transition-colors cursor-pointer ${hasUnread ? 'border-primary/30' : ''}`}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); } }}
      tabIndex={0}
      role="link"
      aria-label={`${group.name} chat group${hasUnread ? `, ${unreadCount} unread messages` : ''}${isMuted ? ', muted' : ''}`}
    >
      <CardContent className="py-3 px-2.5 flex items-center gap-2">
        <div className="relative shrink-0">
          <div className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center">
            <Users className="h-5 w-5 text-secondary-foreground" aria-hidden="true" />
          </div>
          {hasUnread && (
            <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-destructive border-2 border-background" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <h3 className={`truncate text-[15px] leading-tight ${hasUnread ? 'font-bold' : 'font-semibold'}`}>{group.name}</h3>
              {isMuted && <BellOff className="h-3 w-3 text-muted-foreground shrink-0" aria-label="Muted" />}
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              {lastMessage?.created_at && (
                <span className="text-xs text-muted-foreground">{formatTimeShort(lastMessage.created_at)}</span>
              )}
              {hasUnread && (
                <span className="h-[18px] min-w-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            </div>
          </div>
          <p className={`text-[13px] leading-snug mt-0.5 line-clamp-2 ${hasUnread ? 'text-foreground font-medium' : 'text-foreground/70'}`}>
            <MessagePreviewComponent 
              text={lastMessage?.text} 
              imageUrl={lastMessage?.image_url}
              author={lastMessage?.author}
              hasUnread={hasUnread}
              fallback="No messages yet"
            />
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
