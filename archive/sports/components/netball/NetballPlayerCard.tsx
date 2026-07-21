import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight, Clock, Target, AlertTriangle, Pin } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { NetballPlayer, NetballPosition } from "./types";
import { cn } from "@/lib/utils";

const POSITION_TOKEN_COLORS: Record<NetballPosition, { bg: string; text: string }> = {
  GS: { bg: "bg-red-600", text: "text-white" },
  GA: { bg: "bg-orange-600", text: "text-white" },
  WA: { bg: "bg-amber-600", text: "text-white" },
  C: { bg: "bg-emerald-600", text: "text-white" },
  WD: { bg: "bg-sky-600", text: "text-white" },
  GD: { bg: "bg-indigo-600", text: "text-white" },
  GK: { bg: "bg-violet-600", text: "text-white" },
};

const cleanName = (raw: string): string =>
  raw.replace(/^mock\s+/i, "").replace(/^mock player\s*/i, "Player ").trim() || raw;

interface NetballPlayerCardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  player: NetballPlayer | null;
  /** Open Sub Mode armed with this player. */
  onStartSub: () => void;
  /** Bench/sub off (only on-court). */
  onSubOff: () => void;
  /** Toggle injury flag. */
  onToggleInjured: () => void;
  /** Quick attribute a goal (only valid for GS/GA). */
  onScore?: () => void;
}

/**
 * Lightweight player info card opened by tapping a token outside Sub Mode.
 *
 * Surfaces only the data the coach needs at-a-glance:
 *   - full name + position
 *   - time played this match
 *   - sub status (on court / on bench / injured / fill-in)
 *
 * Primary action is "Sub" — opens Sub Mode pre-armed with this player so the
 * next tap on a target completes the swap.
 */
export default function NetballPlayerCard({
  open,
  onOpenChange,
  player,
  onStartSub,
  onSubOff,
  onToggleInjured,
  onScore,
}: NetballPlayerCardProps) {
  if (!player) return null;
  const displayName = cleanName(player.name);
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const pos = player.position;
  const colors = pos ? POSITION_TOKEN_COLORS[pos] : null;
  const minutes = Math.floor((player.minutesPlayed ?? 0) / 60);
  const onCourt = pos !== null;
  const canScore = onCourt && (pos === "GS" || pos === "GA");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-xl pb-safe">
        <SheetHeader className="text-left">
          <SheetTitle className="sr-only">{displayName}</SheetTitle>
        </SheetHeader>

        {/* Identity row */}
        <div className="flex items-center gap-3 py-2">
          <div className="relative">
            <Avatar className={cn("h-14 w-14 border-2 ring-2 ring-black/30", colors?.bg ?? "bg-muted")}>
              <AvatarFallback className={cn("text-base font-extrabold", colors?.bg, colors?.text)}>
                {player.number !== undefined ? player.number : initials}
              </AvatarFallback>
            </Avatar>
            {pos && (
              <span
                className={cn(
                  "absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[10px] font-bold rounded px-1.5 py-px shadow-sm leading-none",
                  colors?.bg,
                  colors?.text,
                )}
              >
                {pos}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold leading-tight truncate">{displayName}</h3>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {/* Sub status pill */}
              <span
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide",
                  onCourt
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {onCourt ? "On court" : "On bench"}
              </span>
              {player.isInjured && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-destructive/15 text-destructive">
                  <AlertTriangle className="h-2.5 w-2.5" /> Injured
                </span>
              )}
              {player.isFillIn && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300">
                  <Pin className="h-2.5 w-2.5" /> Fill-in
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2 py-3">
          <div className="rounded-lg border border-border bg-card px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> Time played
            </div>
            <div className="text-lg font-bold tabular-nums mt-0.5">{minutes}m</div>
          </div>
          <div className="rounded-lg border border-border bg-card px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Target className="h-3 w-3" /> Goals
            </div>
            <div className="text-lg font-bold tabular-nums mt-0.5">{player.goals ?? 0}</div>
          </div>
        </div>

        {/* Action row */}
        <div className="grid grid-cols-1 gap-2 pb-2">
          <Button
            variant="default"
            className="h-12 justify-start gap-3 text-base font-semibold"
            onClick={() => {
              onStartSub();
              onOpenChange(false);
            }}
          >
            <ArrowLeftRight className="h-5 w-5" />
            {onCourt ? "Sub off" : "Sub on"}
          </Button>

          {canScore && onScore && (
            <Button
              variant="outline"
              className="h-11 justify-start gap-3"
              onClick={() => {
                onScore();
                onOpenChange(false);
              }}
            >
              <Target className="h-5 w-5" />
              <span>+1 goal</span>
            </Button>
          )}

          <Button
            variant="ghost"
            className="h-10 justify-start gap-3 text-muted-foreground"
            onClick={() => {
              onToggleInjured();
              onOpenChange(false);
            }}
          >
            <AlertTriangle className="h-4 w-4" />
            <span>{player.isInjured ? "Mark fit" : "Mark injured"}</span>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
