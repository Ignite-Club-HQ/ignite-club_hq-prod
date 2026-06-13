import { useState, useEffect } from "react";
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
import { Loader2, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getEventTypeLabel } from "@/lib/eventTypeLabel";
import { useNativeKeyboardBottomInset } from "@/hooks/useNativeKeyboardBottomInset";


interface RecurringCancelEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventTitle: string;
  teamId: string | null;
  clubId: string;
  miniLeagueId?: string | null;
  eventType?: string | null;
  onSingleAction: (customMessage?: string, sendPushNotification?: boolean) => void;
  onSeriesAction: (customMessage?: string, sendPushNotification?: boolean) => void;
  isPending?: boolean;
}

export function RecurringCancelEventDialog({
  open,
  onOpenChange,
  eventTitle,
  teamId,
  clubId,
  miniLeagueId,
  eventType,
  onSingleAction,
  onSeriesAction,
  isPending,
}: RecurringCancelEventDialogProps) {
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [customMessage, setCustomMessage] = useState("");
  const [sendPushNotification, setSendPushNotification] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setCustomMessage("");
      setSendPushNotification(true);
      fetchMemberCount();
    }
  }, [open, teamId, clubId, miniLeagueId]);

  const fetchMemberCount = async () => {
    setIsLoading(true);
    try {
      // For mini-league events, count parents + league/club admins
      if (miniLeagueId) {
        // Get mini league to find the club_id
        const { data: league } = await supabase
          .from("mini_leagues")
          .select("club_id")
          .eq("id", miniLeagueId)
          .single();
        
        if (league) {
          // Get all parent user IDs from mini league players
          const { data: playersData } = await supabase
            .from("mini_league_players")
            .select("parent_user_id")
            .eq("mini_league_id", miniLeagueId)
            .not("parent_user_id", "is", null);
          
          const parentIds = [...new Set(
            (playersData?.map(p => p.parent_user_id).filter(Boolean) as string[]) || []
          )];
          
          // Get club admins, league admins, and coaches
          const { data: adminRoles } = await supabase
            .from("user_roles")
            .select("user_id")
            .eq("club_id", league.club_id)
            .in("role", ["club_admin", "league_admin", "coach"]);
          
          const adminIds = adminRoles?.map(r => r.user_id) || [];
          
          // Combine all unique IDs
          const allUserIds = [...new Set([...parentIds, ...adminIds])];
          setMemberCount(allUserIds.length);
        } else {
          setMemberCount(null);
        }
      } else {
        // Standard team/club member count
        let memberQuery = supabase.from("user_roles").select("user_id");
        if (teamId) {
          memberQuery = memberQuery.eq("team_id", teamId);
        } else {
          memberQuery = memberQuery.eq("club_id", clubId);
        }

        const { data: members } = await memberQuery;
        const uniqueMembers = [...new Set(members?.map(m => m.user_id) || [])];
        setMemberCount(uniqueMembers.length);
      }
    } catch (error) {
      console.error("Failed to fetch member count:", error);
      setMemberCount(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSingleAction = () => {
    onSingleAction(customMessage.trim() || undefined, sendPushNotification);
    onOpenChange(false);
  };

  const handleSeriesAction = () => {
    onSeriesAction(customMessage.trim() || undefined, sendPushNotification);
    onOpenChange(false);
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
      <DialogContent className="sm:max-w-[425px] top-[max(1rem,env(safe-area-inset-top))] translate-y-0 sm:top-[50%] sm:translate-y-[-50%] max-h-[calc(100dvh-2rem)]">
        <DialogHeader>
          <DialogTitle>Cancel {typeLabel}?</DialogTitle>
          <DialogDescription className="space-y-2">
            <span className="block">
              You are about to cancel "{eventTitle}".
            </span>
            {isLoading ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Counting members...
              </span>
            ) : memberCount !== null ? (
              <span className="block font-medium text-foreground">
                {memberCount} member{memberCount === 1 ? "" : "s"} will be notified.
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="custom-message-recurring">
              Custom message (optional)
            </Label>
            <Textarea
              id="custom-message-recurring"
              placeholder="Add a reason or message for members..."
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              className="min-h-[80px]"
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">
              {customMessage.length}/500 characters
            </p>
          </div>

          {/* Push notification option */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="send-push-recurring"
              checked={sendPushNotification}
              onCheckedChange={(checked) => setSendPushNotification(checked === true)}
            />
            <Label htmlFor="send-push-recurring" className="text-sm font-normal cursor-pointer">
              Also send push notification to members
            </Label>
          </div>

          {/* Chat Message Preview - always shown */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" />
              Message will be posted to {chatType} chat
            </Label>
            <div className="rounded-md border bg-muted/50 p-3">
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {getChatMessagePreview()}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 pt-2">
          <Button
            variant="default"
            className="w-full bg-warning text-warning-foreground hover:bg-warning/90 min-h-[44px]"
            onClick={handleSeriesAction}
            disabled={isPending || isLoading}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Cancelling...
              </>
            ) : (
              "Cancel Entire Series"
            )}
          </Button>
          <Button
            variant="outline"
            className="w-full min-h-[44px]"
            onClick={handleSingleAction}
            disabled={isPending || isLoading}
          >
            Cancel This {typeLabel} Only
          </Button>
          <Button
            variant="ghost"
            className="w-full min-h-[44px]"
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
