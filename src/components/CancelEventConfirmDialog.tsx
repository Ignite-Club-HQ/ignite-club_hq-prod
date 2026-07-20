import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle, Loader2, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getEventTypeLabel } from "@/lib/eventTypeLabel";
import { useNativeKeyboardBottomInset } from "@/hooks/useNativeKeyboardBottomInset";


interface CancelEventConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  eventTitle: string;
  teamId: string | null;
  clubId: string;
  miniLeagueId?: string | null;
  eventType?: string | null;
  onConfirm: (customMessage?: string, sendPushNotification?: boolean) => void;
  isPending?: boolean;
}

export function CancelEventConfirmDialog({
  open,
  onOpenChange,
  eventId,
  eventTitle,
  teamId,
  clubId,
  miniLeagueId,
  eventType,
  onConfirm,
  isPending,
}: CancelEventConfirmDialogProps) {
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [customMessage, setCustomMessage] = useState("");
  const [sendPushNotification, setSendPushNotification] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [recipientLookupFailed, setRecipientLookupFailed] = useState(false);
  const keyboardBottomInset = useNativeKeyboardBottomInset();
  const requestIdRef = useRef(0);


  useEffect(() => {
    if (open) {
      setCustomMessage("");
      setSendPushNotification(true);
      setRecipientLookupFailed(false);
      const reqId = ++requestIdRef.current;
      fetchMemberCount(reqId);
    } else {
      // Invalidate any in-flight lookup so its result cannot leak into a later open
      requestIdRef.current++;
    }
  }, [open, teamId, clubId, miniLeagueId]);

  const fetchMemberCount = async (reqId: number) => {
    setIsLoading(true);
    setRecipientLookupFailed(false);
    const isCurrent = () => requestIdRef.current === reqId;
    try {
      // For mini-league events, count parents + league/club admins
      if (miniLeagueId) {
        // Get mini league to find the club_id
        const { data: league, error: leagueError } = await supabase
          .from("mini_leagues")
          .select("club_id")
          .eq("id", miniLeagueId)
          .maybeSingle();
        if (leagueError) throw leagueError;

        if (league) {
          // Get all parent user IDs from mini league players
          const { data: playersData, error: playersError } = await supabase
            .from("mini_league_players")
            .select("parent_user_id")
            .eq("mini_league_id", miniLeagueId)
            .not("parent_user_id", "is", null);
          if (playersError) throw playersError;

          const parentIds = [...new Set(
            (playersData?.map(p => p.parent_user_id).filter(Boolean) as string[]) || []
          )];

          // Get club admins, league admins, and coaches
          const { data: adminRoles, error: adminError } = await supabase
            .from("user_roles")
            .select("user_id")
            .eq("club_id", league.club_id)
            .in("role", ["club_admin", "league_admin", "coach"]);
          if (adminError) throw adminError;

          const adminIds = adminRoles?.map(r => r.user_id) || [];

          // Combine all unique IDs
          const allUserIds = [...new Set([...parentIds, ...adminIds])];
          if (!isCurrent()) return;
          setMemberCount(allUserIds.length);
          setSendPushNotification(true);
        } else {
          throw new Error("Mini league not found");
        }
      } else {
        // Standard team/club member count
        let memberQuery = supabase.from("user_roles").select("user_id");
        if (teamId) {
          memberQuery = memberQuery.eq("team_id", teamId);
        } else {
          memberQuery = memberQuery.eq("club_id", clubId);
        }

        const { data: members, error: membersError } = await memberQuery;
        if (membersError) throw membersError;
        const uniqueMembers = [...new Set(members?.map(m => m.user_id) || [])];
        if (!isCurrent()) return;
        setMemberCount(uniqueMembers.length);
        setSendPushNotification(true);
      }
    } catch (error) {
      console.error("Failed to fetch member count:", error);
      if (!isCurrent()) return;
      setMemberCount(null);
      setRecipientLookupFailed(true);
      setSendPushNotification(false);
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  };

  const handleConfirm = () => {
    const push = recipientLookupFailed ? false : sendPushNotification;
    onConfirm(customMessage.trim() || undefined, push);
  };

  const getChatMessagePreview = () => {
    const baseMessage = `📢 Event Cancelled: "${eventTitle}"`;
    if (customMessage.trim()) {
      return `${baseMessage}\n\n${customMessage.trim()}\n\nView event: [link]`;
    }
    return `${baseMessage}\n\nView event: [link]`;
  };

  const chatType = miniLeagueId ? "league" : (teamId ? "team" : "club");

  const typeLabel = getEventTypeLabel(eventType, { miniLeagueId });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[425px] top-[max(0.75rem,env(safe-area-inset-top))] translate-y-0 sm:top-[50%] sm:translate-y-[-50%] p-0 gap-0 flex flex-col overflow-hidden w-[calc(100vw-1rem)]"
        style={{ maxHeight: `calc(100dvh - ${keyboardBottomInset + 24}px)` }}
      >

        <DialogHeader className="p-4 sm:p-6 pb-2 shrink-0">
          <DialogTitle className="text-left">Cancel {typeLabel}?</DialogTitle>
          <DialogDescription className="space-y-2 text-left">
            <span className="block">
              You are about to cancel "{eventTitle}".
            </span>
            {isLoading ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Counting members...
              </span>
            ) : recipientLookupFailed ? null : memberCount !== null ? (
              <span className="block font-medium text-foreground">
                {memberCount} member{memberCount === 1 ? "" : "s"} will be notified.
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-2 space-y-4 min-h-0">
          <div className="space-y-2">
            <Label htmlFor="custom-message">
              Custom message (optional)
            </Label>
            <Textarea
              id="custom-message"
              placeholder="Add a reason or message for members..."
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              className="min-h-[72px]"
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">
              {customMessage.length}/500 characters
            </p>
          </div>

          {/* Push notification option */}
          <div className="flex items-start space-x-2">
            <Checkbox
              id="send-push"
              checked={sendPushNotification}
              disabled={isLoading || recipientLookupFailed || isPending}
              onCheckedChange={(checked) => setSendPushNotification(checked === true)}
              className="mt-0.5"
            />
            <Label htmlFor="send-push" className="text-sm font-normal cursor-pointer leading-tight">
              Also send push notification to members
            </Label>
          </div>

          {recipientLookupFailed && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-warning" />
              <span>
                Recipients could not be verified. You can still cancel this event,
                but push notifications will not be sent.
              </span>
            </div>
          )}

          {/* Chat Message Preview - always shown */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Message will be posted to {chatType} chat</span>
            </Label>
            <div className="rounded-md border bg-muted/50 p-3">
              <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                {getChatMessagePreview()}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:gap-2 p-4 sm:p-6 pt-3 border-t bg-background shrink-0">
          <Button
            variant="default"
            className="w-full sm:w-auto bg-warning text-warning-foreground hover:bg-warning/90 min-h-[44px]"
            onClick={handleConfirm}
            disabled={isPending || isLoading}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Cancelling...
              </>
            ) : (
              `Cancel ${typeLabel}`
            )}
          </Button>
          <Button
            variant="outline"
            className="w-full sm:w-auto min-h-[44px]"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Keep {typeLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
