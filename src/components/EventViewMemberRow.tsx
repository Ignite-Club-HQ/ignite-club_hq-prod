import { useState, useRef } from "react";
import { Bell, BellOff, BellRing, Loader2, Mail, Smartphone, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface MemberWithViewStatus {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  hasViewed: boolean;
  viewedAt?: string;
}

interface EventViewMemberRowProps {
  member: MemberWithViewStatus;
  variant: "viewed" | "not-viewed";
  pushDisabled: boolean;
  noPushSetup: boolean;
  isBusy: boolean;
  onSendReminder: (channels: "push" | "email" | "both", userIds: string[]) => void;
  onNudge: (userId: string, displayName: string) => void;
}

const LONG_PRESS_MS = 600;
const MOVE_THRESHOLD = 10;

export function EventViewMemberRow({
  member,
  variant,
  pushDisabled,
  noPushSetup,
  isBusy,
  onSendReminder,
  onNudge,
}: EventViewMemberRowProps) {
  const [showMenu, setShowMenu] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
    longPressTimer.current = setTimeout(() => {
      setShowMenu(true);
    }, LONG_PRESS_MS);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStart.current || !longPressTimer.current) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchStart.current.x);
    const dy = Math.abs(touch.clientY - touchStart.current.y);
    if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  return (
    <div
      className={`flex items-center gap-2 p-2 rounded-lg select-none ${
        variant === "viewed" ? "bg-primary/5" : "bg-muted/50"
      }`}
      onTouchStart={variant === "not-viewed" ? handleTouchStart : undefined}
      onTouchMove={variant === "not-viewed" ? handleTouchMove : undefined}
      onTouchEnd={variant === "not-viewed" ? handleTouchEnd : undefined}
      onContextMenu={(e) => { if (variant === "not-viewed") e.preventDefault(); }}
    >
      <Avatar className="h-7 w-7">
        <AvatarImage src={member.avatar_url || undefined} />
        <AvatarFallback className="text-xs">
          {member.display_name?.charAt(0)?.toUpperCase() || "?"}
        </AvatarFallback>
      </Avatar>
      <span className="text-sm truncate flex-1">{member.display_name || "Unknown"}</span>
      <div className="flex items-center gap-1 shrink-0">
        {(pushDisabled || noPushSetup) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="p-0.5 rounded text-destructive/70">
                <BellOff className="h-3.5 w-3.5" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p>{noPushSetup ? "No push notifications set up" : "Event push notifications disabled"}</p>
            </TooltipContent>
          </Tooltip>
        )}
        {variant === "viewed" && member.viewedAt && (
          <span className="text-xs text-muted-foreground">
            {new Date(member.viewedAt).toLocaleDateString()}
          </span>
        )}
        {variant === "not-viewed" && showMenu && (
          <DropdownMenu modal={false} open={showMenu} onOpenChange={setShowMenu}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 touch-none"
                disabled={isBusy}
              >
                {isBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <MoreVertical className="h-3.5 w-3.5" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onSendReminder("push", [member.id])}>
                <Smartphone className="h-4 w-4 mr-2" />
                Send Push
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSendReminder("email", [member.id])}>
                <Mail className="h-4 w-4 mr-2" />
                Send Email
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSendReminder("both", [member.id])}>
                <Bell className="h-4 w-4 mr-2" />
                Send Both
              </DropdownMenuItem>
              {noPushSetup && (
                <DropdownMenuItem onClick={() => onNudge(member.id, member.display_name || "Member")}>
                  <BellRing className="h-4 w-4 mr-2" />
                  Nudge to Enable Push
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
