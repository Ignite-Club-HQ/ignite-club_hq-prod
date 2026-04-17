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
  Target,
  Undo2,
} from "lucide-react";
import { BasketballPlayer, BASKETBALL_POSITION_LABELS } from "./types";
import { cn } from "@/lib/utils";

interface BasketballQuickActionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  player: BasketballPlayer | null;
  onStartSwap: () => void;
  onSubOff: () => void;
  onSubOn: () => void;
  onToggleInjured: () => void;
  onAddFoul: () => void;
  /** Clear a fouled-out flag (coach override). */
  onClearFoulOut?: () => void;
  /** Attribute a basket to this player (home side). */
  onScore?: (points: 1 | 2 | 3) => void;
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
  onClearFoulOut,
  onScore,
}: BasketballQuickActionSheetProps) {
  if (!player) return null;
  const onCourt = player.position !== null;
  const fouledOut = !!player.isFouledOut;

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
            <div className="ml-auto flex items-center gap-1.5 text-xs">
              {(player.points ?? 0) > 0 && (
                <span className="font-semibold text-primary">{player.points} pts</span>
              )}
              {(player.fouls ?? 0) > 0 && (
                <span
                  className={cn(
                    "font-medium",
                    fouledOut ? "text-destructive" : "text-muted-foreground"
                  )}
                >
                  {player.fouls}F
                </span>
              )}
            </div>
          </SheetTitle>
          {/* Foul pips: ●●●○○ for visual fouls (FIBA = 5) */}
          {!fouledOut && (
            <div
              className="flex items-center gap-1 pt-1"
              role="img"
              aria-label={`${player.fouls ?? 0} of 5 fouls`}
            >
              {Array.from({ length: 5 }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "w-2 h-2 rounded-full",
                    i < (player.fouls ?? 0)
                      ? (player.fouls ?? 0) >= 4
                        ? "bg-destructive"
                        : "bg-muted-foreground"
                      : "bg-muted"
                  )}
                />
              ))}
            </div>
          )}
        </SheetHeader>

        {/* Per-player score attribution — only when on court & game-side actions enabled */}
        {onScore && onCourt && !fouledOut && (
          <div className="pt-3 pb-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5">
              Score for {player.name.split(" ")[0]}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {([1, 2, 3] as const).map((pts) => (
                <Button
                  key={pts}
                  variant="default"
                  size="lg"
                  className="h-12 text-base font-bold"
                  onClick={() => {
                    onScore(pts);
                    onOpenChange(false);
                  }}
                >
                  <Target className="h-4 w-4 mr-1" />+{pts}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 py-4">
          <Button
            variant="outline"
            className="h-14 flex-col gap-1"
            onClick={() => {
              onStartSwap();
              onOpenChange(false);
            }}
            disabled={fouledOut}
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
              disabled={fouledOut}
            >
              <LogIn className="h-5 w-5" />
              <span className="text-xs">{fouledOut ? "Fouled out" : "Sub on…"}</span>
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

          {fouledOut && onClearFoulOut ? (
            <Button
              variant="outline"
              className="h-14 flex-col gap-1"
              onClick={() => {
                onClearFoulOut();
                onOpenChange(false);
              }}
            >
              <Undo2 className="h-5 w-5" />
              <span className="text-xs">Clear foul-out</span>
            </Button>
          ) : (
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
          )}

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
