import { Button } from "@/components/ui/button";
import { ArrowLeft, Bookmark, CheckCircle2, Circle, Play, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import BasketballCourtArea from "./BasketballCourtArea";
import BasketballBench from "./BasketballBench";
import { BasketballPlayer, BasketballPosition, BasketballCourtView, PeriodType } from "./types";

interface BasketballPreGameScreenProps {
  teamName: string;
  opponentName: string;
  players: BasketballPlayer[];
  bench: BasketballPlayer[];
  selectedPlayerId: string | null;
  courtView: BasketballCourtView;
  onPlayerClick: (id: string) => void;
  onSlotClick: (pos: BasketballPosition) => void;

  minutesPerQuarter: number;
  periodType: PeriodType;

  onOpenSettings: () => void;
  onOpenSquad: () => void;
  onOpenPresets: () => void;
  hasPresets: boolean;

  onStartGame: () => void;
  onBack: () => void;

  readOnly?: boolean;
}

/**
 * Pre-game checklist: pick the starting 5 by tapping court slots,
 * confirm game length, then start. No live-game UI here — and once
 * "Start Game" fires the parent flips to the live board.
 */
export default function BasketballPreGameScreen({
  teamName,
  opponentName,
  players,
  bench,
  selectedPlayerId,
  courtView,
  onPlayerClick,
  onSlotClick,
  minutesPerQuarter,
  periodType,
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

  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto">
      {/* Header */}
      <header className="flex items-center gap-2 px-2 py-2 border-b bg-card sticky top-0 z-20">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label="Close"
          className="flex-shrink-0 h-9 w-9"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0 text-center">
          <h1 className="font-bold text-sm truncate leading-tight">
            <span className="text-foreground">{teamName}</span>
            <span className="text-muted-foreground mx-1.5 font-normal">vs</span>
            <span className="text-foreground">{opponentName}</span>
          </h1>
        </div>
        <div className="w-9" />
      </header>

      {/* Title */}
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-lg font-bold tracking-tight">Game Ready</h2>
        <p className="text-xs text-muted-foreground">Tap a bench player, then tap a court slot to place them.</p>
      </div>

      {/* Checklist */}
      <div className="px-3 pb-3 space-y-2">
        {/* Squad — always visible, prominent. Becomes the primary CTA when empty. */}
        {squadEmpty ? (
          <div className="flex items-center justify-between gap-3 px-3 py-3 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5">
            <div className="flex items-center gap-2.5 min-w-0">
              <Users className="h-5 w-5 text-primary shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-tight">No players in squad</div>
                <div className="text-[11px] text-muted-foreground">
                  Add players before you can pick a starting 5.
                </div>
              </div>
            </div>
            {!readOnly && (
              <Button size="sm" onClick={onOpenSquad} className="h-8 text-xs shrink-0">
                Add players
              </Button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={readOnly ? undefined : onOpenSquad}
            disabled={readOnly}
            className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border bg-card w-full text-left hover:bg-muted/30 transition-colors disabled:opacity-60"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Users className="h-5 w-5 text-primary shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-tight">Squad</div>
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {players.length} player{players.length === 1 ? "" : "s"} · tap to manage
                </div>
              </div>
            </div>
            {!readOnly && (
              <span className="text-[11px] font-medium text-primary shrink-0">Manage</span>
            )}
          </button>
        )}

        {!squadEmpty && (
          /* Starting 5 */
          <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border bg-card">
            <div className="flex items-center gap-2.5 min-w-0">
              {lineupReady ? (
                <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-tight">Starting 5</div>
                <div
                  className={cn(
                    "text-[11px] tabular-nums",
                    lineupReady ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  {onCourtCount} / 5 selected
                </div>
              </div>
            </div>
            {hasPresets && !readOnly && (
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={onOpenPresets}>
                <Bookmark className="h-3.5 w-3.5 mr-1" />
                Presets
              </Button>
            )}
          </div>
        )}

        {/* Game length */}
        <button
          type="button"
          onClick={onOpenSettings}
          disabled={readOnly}
          className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border bg-card w-full text-left hover:bg-muted/30 transition-colors disabled:opacity-60"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-tight">Game length</div>
              <div className="text-[11px] text-muted-foreground tabular-nums">
                {periodCount} × {minutesPerQuarter} min {periodLabel}s
              </div>
            </div>
          </div>
          <Settings className="h-4 w-4 text-muted-foreground shrink-0" />
        </button>

      </div>

      {/* Bench — shown ABOVE the court so coaches see who's available before tapping a slot */}
      <BasketballBench
        bench={bench}
        selectedPlayerId={selectedPlayerId}
        nextSubInId={null}
        readOnly={readOnly}
        onPlayerClick={onPlayerClick}
      />

      {/* Court — interactive slot assignment */}
      <BasketballCourtArea
        players={players}
        selectedPlayerId={selectedPlayerId}
        nextSubOutId={null}
        readOnly={readOnly}
        courtView={courtView}
        onPlayerClick={onPlayerClick}
        onSlotClick={onSlotClick}
      />

      {/* Sticky CTA */}
      {!readOnly && (
        <div className="sticky bottom-0 px-3 py-3 border-t bg-card/95 backdrop-blur">
          <Button
            size="lg"
            className="w-full h-12 text-base font-semibold"
            disabled={!lineupReady}
            onClick={squadEmpty ? onOpenSquad : onStartGame}
          >
            <Play className="h-5 w-5 mr-2" />
            {squadEmpty
              ? "Add players to start"
              : lineupReady
              ? "Start Game"
              : `Pick Starting 5 (${onCourtCount}/5)`}
          </Button>
        </div>
      )}
    </div>
  );
}
