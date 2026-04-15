import { useState } from "react";
import { Bell, BellOff, BellRing, Loader2, Mail, Smartphone, Share2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";

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
  /** When true, the member has already responded – disable reminder actions */
  hasResponded?: boolean;
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
  hasResponded = false,
}: EventViewMemberRowProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const handleAction = (action: () => void) => {
    setSheetOpen(false);
    action();
  };

  return (
    <>
      <div
        className={`flex items-center gap-2 p-2 rounded-lg select-none cursor-pointer active:bg-muted/80 transition-colors ${
          variant === "viewed" ? "bg-primary/5" : "bg-muted/50"
        }`}
        onClick={() => {
          if (!hasResponded) setSheetOpen(true);
        }}
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
        </div>
      </div>

      {!hasResponded && (
        <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
          <DrawerContent className="max-h-[85vh]">
            <DrawerHeader className="pb-2">
              <DrawerTitle className="sr-only">Member Actions</DrawerTitle>
            </DrawerHeader>
            <div className="px-4 pb-6 space-y-4">
              {/* Profile header */}
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={member.avatar_url || undefined} />
                  <AvatarFallback className="text-sm">
                    {member.display_name?.charAt(0)?.toUpperCase() || "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{member.display_name || "Unknown"}</p>
                  <p className="text-xs text-muted-foreground">
                    {noPushSetup ? "No push notifications set up" : pushDisabled ? "Push notifications disabled" : "Send a reminder"}
                  </p>
                </div>
              </div>

              {/* Action buttons */}
              <div className="grid gap-2">
                <Button
                  variant="outline"
                  className="justify-start gap-2 h-11"
                  disabled={isBusy}
                  onClick={() => handleAction(() => onSendReminder("push", [member.id]))}
                >
                  {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4 text-blue-500" />}
                  Send Push Notification
                </Button>
                <Button
                  variant="outline"
                  className="justify-start gap-2 h-11"
                  disabled={isBusy}
                  onClick={() => handleAction(() => onSendReminder("email", [member.id]))}
                >
                  {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4 text-emerald-500" />}
                  Send Email Reminder
                </Button>
                <Button
                  variant="outline"
                  className="justify-start gap-2 h-11"
                  disabled={isBusy}
                  onClick={() => handleAction(() => onSendReminder("both", [member.id]))}
                >
                  {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4 text-amber-500" />}
                  Send Both (Push + Email)
                </Button>
                {onShareLink && (
                  <Button
                    variant="outline"
                    className="justify-start gap-2 h-11"
                    onClick={() => handleAction(onShareLink)}
                  >
                    <Share2 className="h-4 w-4 text-purple-500" />
                    Share via Link
                  </Button>
                )}
                {noPushSetup && (
                  <Button
                    variant="outline"
                    className="justify-start gap-2 h-11"
                    disabled={isBusy}
                    onClick={() => handleAction(() => onNudge(member.id, member.display_name || "Member"))}
                  >
                    <BellRing className="h-4 w-4 text-orange-500" />
                    Nudge to Enable Push
                  </Button>
                )}
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </>
  );
}
