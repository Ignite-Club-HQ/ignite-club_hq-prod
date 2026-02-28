import { memo } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Heart, HeartOff } from "lucide-react";
import { Player } from "./types";

interface PitchPlayerActionMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  player: Player | null;
  onMarkInjured: (playerId: string) => void;
}

const PitchPlayerActionMenu = memo(function PitchPlayerActionMenu({
  open,
  onOpenChange,
  player,
  onMarkInjured,
}: PitchPlayerActionMenuProps) {
  if (!player) return null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[280px] rounded-xl p-4 z-[999999]">
        <AlertDialogHeader className="pb-2">
          <AlertDialogTitle className="text-base">
            {player.number ? `#${player.number} ` : ""}{player.name}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-xs">
            {player.currentPitchPosition || "On pitch"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Button
            variant="destructive"
            size="sm"
            className="w-full h-10 text-sm gap-2 justify-start"
            onClick={() => {
              onMarkInjured(player.id);
              onOpenChange(false);
            }}
          >
            <HeartOff className="h-4 w-4" />
            Mark Injured &amp; Sub Off
          </Button>
        </div>
        <AlertDialogFooter className="pt-1">
          <AlertDialogCancel className="h-9 text-sm">Cancel</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
});

export default PitchPlayerActionMenu;
