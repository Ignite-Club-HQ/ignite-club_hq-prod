import { useState } from "react";
import { usePointsDisplayName } from "@/hooks/usePointsDisplayName";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Flame, Loader2, Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { recordPointsHistory } from "@/lib/pointsHistory";
import { useAuth } from "@/hooks/useAuth";

interface AwardPointsDialogProps {
  memberId: string;
  memberName: string;
  currentPoints?: number;
  clubId: string;
  clubName: string;
  clubLogoUrl?: string;
  /** Legacy: render with an inline trigger button */
  triggerId?: string;
  /** Controlled mode: pass open + onOpenChange */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function AwardPointsDialog({
  memberId,
  memberName,
  currentPoints = 0,
  clubId,
  clubName,
  clubLogoUrl,
  triggerId,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: AwardPointsDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const pointsName = usePointsDisplayName(clubId);
  const [internalOpen, setInternalOpen] = useState(false);
  const [points, setPoints] = useState(10);
  const [reason, setReason] = useState("");

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (v: boolean) => {
    if (isControlled) controlledOnOpenChange?.(v);
    else setInternalOpen(v);
  };

  const awardMutation = useMutation({
    mutationFn: async () => {
      const previousPoints = currentPoints;
      
      // Atomic points increment via DB function (scoped to this club)
      const { data: newPoints, error: updateError } = await (supabase.rpc as any)('increment_ignite_points', {
        _user_id: memberId,
        _amount: points,
        _club_id: clubId,
      });

      if (updateError) throw updateError;
      const balanceAfter = newPoints || Math.max(0, previousPoints + points);

      // Record in points history
      await recordPointsHistory({
        userId: memberId,
        clubId,
        amount: points,
        balanceAfter,
        sourceType: 'admin_award',
        description: reason || (points > 0 ? 'Points awarded by admin' : 'Points adjustment by admin'),
        createdBy: user?.id,
      });

      // Check reward threshold
      let rewardName: string | undefined;
      if (points > 0 && clubId) {
        const { checkRewardThreshold } = await import("@/lib/rewardThresholdCheck");
        rewardName = await checkRewardThreshold({
          userId: memberId,
          clubId,
          previousPoints,
          newPoints: balanceAfter,
        });
      }

      // Create a notification for the member
      const pointsText = points > 0 ? `+${points}` : `${points}`;
      const message = reason 
        ? `You received ${pointsText} ${pointsName} from ${clubName}: "${reason}"`
        : `You received ${pointsText} ${pointsName} from ${clubName}`;

      const { error: notificationError } = await supabase
        .from("notifications")
        .insert({
          user_id: memberId,
          type: "points_awarded",
          message,
          related_id: clubId,
        });

      if (notificationError) {
        console.error("Failed to create notification:", notificationError);
      }

      // Send email notification
      try {
        await supabase.functions.invoke('send-points-notification-email', {
          body: {
            recipientUserId: memberId,
            pointsAwarded: points,
            reason: reason || (points > 0 ? 'Points awarded by admin' : 'Points adjustment'),
            totalPoints: balanceAfter,
            clubName,
            clubLogoUrl,
            rewardUnlocked: !!rewardName,
            rewardName,
          },
        });
      } catch (emailErr) {
        console.error("Failed to send points email:", emailErr);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-members-roles", clubId] });
      setOpen(false);
      setPoints(10);
      setReason("");
      toast({
        title: points > 0 ? "Points Awarded!" : "Points Deducted",
        description: `${points > 0 ? "+" : ""}${points} points ${points > 0 ? "awarded to" : "deducted from"} ${memberName}`,
      });
    },
    onError: () => {
      toast({
        title: "Failed to update points",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (points === 0) {
      toast({ title: "Please enter a point value", variant: "destructive" });
      return;
    }
    awardMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Award Points" id={triggerId}>
            <Flame className="h-4 w-4 text-amber-500" />
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-amber-500" />
            Award Points
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 pt-2">
          <div className="text-center">
            <p className="font-medium">{memberName}</p>
            <p className="text-sm text-muted-foreground">
              Current: {currentPoints} points
            </p>
          </div>

          <div className="space-y-2">
            <Label>Points to Award/Deduct</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setPoints(Math.max(-50, points - 5))}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Input
                type="number"
                value={points}
                onChange={(e) => setPoints(parseInt(e.target.value) || 0)}
                className="text-center text-lg font-bold"
                min={-50}
                max={50}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setPoints(Math.min(50, points + 5))}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Use negative values to deduct points
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">Reason (optional)</Label>
            <Textarea
              id="reason"
              placeholder="e.g., Extra help at training"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              rows={2}
            />
          </div>

          <div className="pt-2 space-y-2">
            <div className="text-center text-sm">
              New balance: <span className="font-bold">{Math.max(0, currentPoints + points)}</span> points
            </div>
            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={awardMutation.isPending || points === 0}
            >
              {awardMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : points > 0 ? (
                `Award +${points} Points`
              ) : (
                `Deduct ${points} Points`
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
