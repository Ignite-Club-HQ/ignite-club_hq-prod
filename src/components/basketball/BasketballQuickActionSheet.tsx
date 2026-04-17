import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  ArrowLeftRight,
  LogOut,
  LogIn,
  AlertTriangle,
  X,
  Plus,
} from "lucide-react";
import { BasketballPlayer, BASKETBALL_POSITION_LABELS } from "./types";

interface BasketballQuickActionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  player: BasketballPlayer | null;
  onStartSwap: () => void;
  onSubOff: () => void;
  onSubOn: () => void;
  onToggleInjured: () => void;
  onAddFoul: () => void;
}

export default function BasketballQuickActionSheet({
  open,
  onOpenChange,
  player,
  onStartSwap,
  onSubOff,
  onSubOn,
  onToggleInjured,
  onAddFoul,
}: BasketballQuickActionSheetProps) {
  if (!player) return null;
  const onCourt = player.position !== null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-xl pb-safe">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2">
            {player.number !== undefined && (
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                {player.number}
              </span>
            )}
            <span className="truncate">{player.name}</span>
            {player.position && (
              <span className="text-xs font-normal text-muted-foreground">
                · {BASKETBALL_POSITION_LABELS[player.position]}
              </span>
            )}
            {(player.fouls ?? 0) > 0 && (
              <span className="text-xs font-medium text-destructive ml-auto">
                {player.fouls}F
              </span>
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="grid grid-cols-2 gap-2 py-4">
          <Button
            variant="outline"
            className="h-14 flex-col gap-1"
            onClick={() => {
              onStartSwap();
              onOpenChange(false);
            }}
          >
            <ArrowLeftRight className="h-5 w-5" />
            <span className="text-xs">Swap with…</span>
          </Button>

          {onCourt ? (
            <Button
              variant="outline"
              className="h-14 flex-col gap-1"
              onClick={() => {
                onSubOff();
                onOpenChange(false);
              }}
            >
              <LogOut className="h-5 w-5" />
              <span className="text-xs">Sub off</span>
            </Button>
          ) : (
            <Button
              variant="outline"
              className="h-14 flex-col gap-1"
              onClick={() => {
                onSubOn();
                onOpenChange(false);
              }}
            >
              <LogIn className="h-5 w-5" />
              <span className="text-xs">Sub on…</span>
            </Button>
          )}

          <Button
            variant="outline"
            className="h-14 flex-col gap-1"
            onClick={() => {
              onAddFoul();
              onOpenChange(false);
            }}
            disabled={(player.fouls ?? 0) >= 6}
          >
            <Plus className="h-5 w-5" />
            <span className="text-xs">Add foul</span>
          </Button>

          <Button
            variant={player.isInjured ? "destructive" : "outline"}
            className="h-14 flex-col gap-1"
            onClick={() => {
              onToggleInjured();
              onOpenChange(false);
            }}
          >
            <AlertTriangle className="h-5 w-5" />
            <span className="text-xs">{player.isInjured ? "Mark fit" : "Mark injured"}</span>
          </Button>

          <Button
            variant="ghost"
            className="h-14 flex-col gap-1 col-span-2"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-5 w-5" />
            <span className="text-xs">Cancel</span>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
