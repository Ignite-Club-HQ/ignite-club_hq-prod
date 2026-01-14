import { useState } from "react";
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
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

interface AwardPointsDialogProps {
  memberId: string;
  memberName: string;
  currentPoints?: number;
  clubId: string;
  clubName: string;
}

export default function AwardPointsDialog({
  memberId,
  memberName,
  currentPoints = 0,
  clubId,
  clubName,
}: AwardPointsDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [points, setPoints] = useState(10);
  const [reason, setReason] = useState("");

  const awardMutation = useMutation({
    mutationFn: async () => {
      // Update the member's ignite points
      const newPoints = Math.max(0, currentPoints + points);
      
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ ignite_points: newPoints })
        .eq("id", memberId);

      if (updateError) throw updateError;

      // Create a notification for the member
      const pointsText = points > 0 ? `+${points}` : `${points}`;
      const message = reason 
        ? `You received ${pointsText} Ignite points from ${clubName}: "${reason}"`
        : `You received ${pointsText} Ignite points from ${clubName}`;

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
        // Don't throw - points were still awarded
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
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="Award Points">
          <Flame className="h-4 w-4 text-amber-500" />
        </Button>
      </DialogTrigger>
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
                onClick={() => setPoints(Math.max(-100, points - 5))}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Input
                type="number"
                value={points}
                onChange={(e) => setPoints(parseInt(e.target.value) || 0)}
                className="text-center text-lg font-bold"
                min={-100}
                max={100}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setPoints(Math.min(100, points + 5))}
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
