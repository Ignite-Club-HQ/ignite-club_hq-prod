import { useState, useRef, useCallback } from "react";
import { Bell, BellOff, BellRing, Loader2, Mail, Smartphone, MoreVertical, Share2 } from "lucide-react";
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
  hasResponded?: boolean;
}

interface EventViewMemberRowProps {
  member: MemberWithViewStatus;
  variant: "viewed" | "not-viewed";
  pushDisabled: boolean;
  noPushSetup: boolean;
  isBusy: boolean;
  onSendReminder: (channels: "push" | "email" | "both", userIds: string[]) => void;
  onNudge: (userId: string, displayName: string) => void;
  onShareLink?: () => void;
}

export function EventViewMemberRow({
  member,
  variant,
  pushDisabled,
  noPushSetup,
  isBusy,
  onSendReminder,
  onNudge,
  onShareLink,
}: EventViewMemberRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showDots, setShowDots] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchMoved = useRef(false);

  const clearTimer = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleTouchStart = useCallback(() => {
    if (variant !== "not-viewed") return;
    touchMoved.current = false;
    longPressTimer.current = setTimeout(() => {
      setShowDots(true);
    }, 600);
  }, [variant]);

  const handleTouchMove = useCallback(() => {
    touchMoved.current = true;
    clearTimer();
  }, [clearTimer]);

  const handleTouchEnd = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  return (
    <div
      className={`flex items-center gap-2 p-2 rounded-lg select-none ${
        variant === "viewed" ? "bg-primary/5" : "bg-muted/50"
      }`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
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
        {variant === "not-viewed" && showDots && (
          <DropdownMenu modal={false} open={menuOpen} onOpenChange={(open) => {
            setMenuOpen(open);
            if (!open) setShowDots(false);
          }}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 touch-none animate-in fade-in duration-150"
                disabled={isBusy}
                onClick={(e) => e.stopPropagation()}
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
              {onShareLink && (
                <DropdownMenuItem onClick={onShareLink}>
                  <Share2 className="h-4 w-4 mr-2" />
                  Share via Link
                </DropdownMenuItem>
              )}
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
