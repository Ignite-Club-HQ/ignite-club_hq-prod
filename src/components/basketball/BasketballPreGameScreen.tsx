import { Button } from "@/components/ui/button";
import { ArrowLeft, Bookmark, Play, Repeat, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import BasketballPreGameLineup from "./BasketballPreGameLineup";
import { BasketballPlayer, BasketballPosition, PeriodType, RotationMode } from "./types";

interface BasketballPreGameScreenProps {
  teamName: string;
  opponentName: string;
  players: BasketballPlayer[];
  bench: BasketballPlayer[];
  /** Direct drag-and-drop assignment. Wired to the hook's `assignToPosition`. */
  onAssign: (playerId: string, position: BasketballPosition | null) => void;

  minutesPerQuarter: number;
  periodType: PeriodType;

  /** Auto-sub plan toggle — coaches flip rotation on/off directly from the
   *  pre-game controls row. When ON we use a sensible default (time-based @ 4m)
   *  unless the coach previously chose another mode/interval. */
  rotationMode?: RotationMode;
  rotationIntervalMinutes?: number;
  onToggleAutoSub?: (next: RotationMode) => void;

  onOpenSettings: () => void;
  onOpenSquad: () => void;
  onOpenPresets: () => void;
  hasPresets: boolean;

  onStartGame: () => void;
  onBack: () => void;

  readOnly?: boolean;
}

/**
 * Drag-first pre-game screen.
 * Court dominates the top of the screen; bench is a drag source below; thin
 * compact header keeps controls accessible without crowding the interaction
 * surface. The whole flow is "see court → drag player on".
 */
export default function BasketballPreGameScreen({
  teamName,
  opponentName,
  players,
  bench,
  onAssign,
  minutesPerQuarter,
  periodType,
  rotationMode = "off",
  rotationIntervalMinutes = 4,
  onToggleAutoSub,
  onOpenSettings,
  onOpenSquad,
  onOpenPresets,
  hasPresets,
  onStartGame,
  onBack,
  readOnly = false,
}: BasketballPreGameScreenProps) {
  const onCourtCount = players.filter((p) => p.position !== null).length;
  const lineupReady = onCourtCount >= 5;
  const periodLabel = periodType === "halves" ? "half" : "quarter";
  const periodCount = periodType === "halves" ? 2 : 4;
  const squadEmpty = players.length === 0;
  const autoSubActive = rotationMode !== "off";
  const autoSubLabel = autoSubActive
    ? rotationMode === "time-based"
      ? `On · every ${rotationIntervalMinutes}m`
      : "On · per period"
    : "Off";

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Slim header */}
      <header className="flex items-center gap-2 px-2 py-1.5 border-b bg-card sticky top-0 z-20">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label="Close"
          className="flex-shrink-0 h-8 w-8"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0 text-center">
          <h1 className="font-bold text-xs truncate leading-tight">
            <span className="text-foreground">{teamName}</span>
            <span className="text-muted-foreground mx-1 font-normal">vs</span>
            <span className="text-foreground">{opponentName}</span>
          </h1>
        </div>
        <div className="w-8" />
      </header>

      {/* Compact status row: title + live progress */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-card/60">
        <h2 className="text-sm font-bold tracking-tight">Game Ready</h2>
        <span
          className={cn(
            "text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full",
            lineupReady
              ? "bg-primary/15 text-primary"
              : "bg-muted text-muted-foreground"
          )}
        >
          {onCourtCount} / 5 selected
        </span>
      </div>

      {/* Compact subtle controls row — wraps so the Auto-subs pill always fits */}
      <div className="flex items-center flex-wrap gap-x-2 gap-y-1 px-3 py-1.5 border-b bg-card/40 text-[11px]">
        <button
          type="button"
          onClick={readOnly ? undefined : onOpenSquad}
          disabled={readOnly}
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
        >
          <Users className="h-3.5 w-3.5" />
          <span className="font-medium">Squad ({players.length})</span>
        </button>
        <span className="text-muted-foreground/50">·</span>
        <button
          type="button"
          onClick={onOpenSettings}
          disabled={readOnly}
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
        >
          <Settings className="h-3.5 w-3.5" />
          <span className="font-medium tabular-nums">
            {periodCount} × {minutesPerQuarter}m {periodLabel}s
          </span>
        </button>
        <span className="text-muted-foreground/50">·</span>
        <button
          type="button"
          onClick={onOpenSettings}
          disabled={readOnly}
          className={cn(
            "inline-flex items-center gap-1 transition-colors disabled:opacity-60",
            autoSubActive
              ? "text-primary hover:underline font-medium"
              : "text-muted-foreground hover:text-foreground"
          )}
          aria-label="Configure auto-sub plan"
        >
          <Repeat className="h-3.5 w-3.5" />
          <span className="font-medium">Auto-subs · {autoSubLabel}</span>
        </button>
        {hasPresets && !readOnly && (
          <>
            <span className="text-muted-foreground/50">·</span>
            <button
              type="button"
              onClick={onOpenPresets}
              className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
            >
              <Bookmark className="h-3.5 w-3.5" />
              Presets
            </button>
          </>
        )}
      </div>

      {/* Empty squad fallback */}
      {squadEmpty ? (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <Users className="h-10 w-10 text-muted-foreground" />
          <div>
            <div className="text-sm font-semibold">No players in squad</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Add players before you can pick a starting 5.
            </div>
          </div>
          {!readOnly && (
            <Button size="sm" onClick={onOpenSquad}>
              Add players
            </Button>
          )}
        </div>
      ) : (
        /* COURT (top, dominant) + BENCH (drag source below) */
        <BasketballPreGameLineup
          players={players}
          bench={bench}
          onAssign={onAssign}
          readOnly={readOnly}
        />
      )}

      {/* Sticky CTA */}
      {!readOnly && !squadEmpty && (
        <div className="sticky bottom-0 px-3 py-2 border-t bg-card/95 backdrop-blur">
          <Button
            size="lg"
            className="w-full h-11 text-sm font-semibold"
            disabled={!lineupReady}
            onClick={onStartGame}
          >
            <Play className="h-4 w-4 mr-2" />
            {lineupReady ? "Start Game" : `Drag ${5 - onCourtCount} more onto court`}
          </Button>
        </div>
      )}
    </div>
  );
}
