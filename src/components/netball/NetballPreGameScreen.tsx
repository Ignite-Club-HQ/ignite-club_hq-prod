import { Button } from "@/components/ui/button";
import { ArrowLeft, Bookmark, Eye, Play, Repeat, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import NetballPreGameLineup from "./NetballPreGameLineup";
import { NetballPlayer, NetballPosition, PeriodType, RotationMode, ValidationMode } from "./types";

const ROTATION_SPEEDS: { minutes: number; label: string }[] = [
  { minutes: 4, label: "4m" },
  { minutes: 5, label: "5m" },
  { minutes: 6, label: "6m" },
];

interface NetballPreGameScreenProps {
  teamName: string;
  opponentName: string;
  players: NetballPlayer[];
  bench: NetballPlayer[];
  onAssign: (playerId: string, position: NetballPosition | null) => void;

  minutesPerQuarter: number;
  periodType: PeriodType;

  rotationMode?: RotationMode;
  rotationIntervalMinutes?: number;
  onToggleAutoSub?: (next: RotationMode) => void;
  onRotationIntervalChange?: (n: number) => void;
  onPreviewPlan?: () => void;
  hasAutoSubPlan?: boolean;

  validationMode?: ValidationMode;

  onOpenSettings: () => void;
  onOpenSquad: () => void;
  onOpenPresets: () => void;
  onOpenLineups?: () => void;
  hasPresets: boolean;

  onStartGame: () => void;
  onBack: () => void;

  readOnly?: boolean;
}

/**
 * Drag-first pre-game screen for netball — mirror of BasketballPreGameScreen.
 * Court dominates the top of the screen; bench is a drag source below; thin
 * compact header keeps controls accessible without crowding the surface.
 */
export default function NetballPreGameScreen({
  teamName,
  opponentName,
  players,
  bench,
  onAssign,
  minutesPerQuarter,
  periodType,
  rotationMode = "off",
  rotationIntervalMinutes = 5,
  onToggleAutoSub,
  onRotationIntervalChange,
  onPreviewPlan,
  hasAutoSubPlan = false,
  validationMode = "warn",
  onOpenSettings,
  onOpenSquad,
  onOpenPresets,
  onOpenLineups,
  hasPresets,
  onStartGame,
  onBack,
  readOnly = false,
}: NetballPreGameScreenProps) {
  const onCourtCount = players.filter((p) => p.position !== null).length;
  const lineupReady = onCourtCount >= 7;
  const periodLabel = periodType === "halves" ? "half" : "quarter";
  const periodCount = periodType === "halves" ? 2 : 4;
  const squadEmpty = players.length === 0;
  const autoSubActive = rotationMode !== "off";
  const showSpeedPicker = autoSubActive && rotationMode === "time-based";
  const canPreview = autoSubActive && hasAutoSubPlan && lineupReady && !!onPreviewPlan;

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

      {/* Compact status row */}
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
          {onCourtCount} / 7 selected
        </span>
      </div>

      {/* Compact subtle controls row */}
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
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => onToggleAutoSub?.(autoSubActive ? "off" : "time-based")}
            disabled={readOnly || !onToggleAutoSub}
            role="switch"
            aria-checked={autoSubActive}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 transition-colors disabled:opacity-60",
              autoSubActive
                ? "bg-primary/15 text-primary font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
            aria-label={autoSubActive ? "Turn auto-subs off" : "Turn auto-subs on"}
          >
            <Repeat className="h-3.5 w-3.5" />
            <span className="font-medium whitespace-nowrap">
              Auto-subs{!autoSubActive && " · Off"}
            </span>
          </button>

          {showSpeedPicker && (
            <div
              role="radiogroup"
              aria-label="Rotation speed"
              className="inline-flex items-center rounded-full border border-border/60 bg-background/60 p-0.5"
            >
              {ROTATION_SPEEDS.map((opt) => {
                const active = rotationIntervalMinutes === opt.minutes;
                return (
                  <button
                    key={opt.minutes}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={readOnly || !onRotationIntervalChange}
                    onClick={() => onRotationIntervalChange?.(opt.minutes)}
                    className={cn(
                      "px-1.5 h-5 rounded-full text-[10px] font-semibold tabular-nums transition-colors disabled:opacity-60",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          )}

          {canPreview && (
            <button
              type="button"
              onClick={onPreviewPlan}
              className="inline-flex items-center gap-1 text-primary hover:underline font-medium ml-0.5"
              aria-label="Preview auto-sub plan"
            >
              <Eye className="h-3.5 w-3.5" />
              <span className="whitespace-nowrap">Preview</span>
            </button>
          )}
        </div>
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
        {onOpenLineups && !readOnly && (
          <>
            <span className="text-muted-foreground/50">·</span>
            <button
              type="button"
              onClick={onOpenLineups}
              className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
            >
              Lineups
            </button>
          </>
        )}
      </div>

      {squadEmpty ? (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <Users className="h-10 w-10 text-muted-foreground" />
          <div>
            <div className="text-sm font-semibold">No players in squad</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Add players before you can pick a starting 7.
            </div>
          </div>
          {!readOnly && (
            <Button size="sm" onClick={onOpenSquad}>
              Add players
            </Button>
          )}
        </div>
      ) : (
        <NetballPreGameLineup
          players={players}
          bench={bench}
          onAssign={onAssign}
          validationMode={validationMode}
          readOnly={readOnly}
        />
      )}

      {!readOnly && !squadEmpty && (
        <div className="sticky bottom-0 px-3 py-2 border-t bg-card/95 backdrop-blur">
          <Button
            size="lg"
            className="w-full h-11 text-sm font-semibold"
            disabled={!lineupReady}
            onClick={onStartGame}
          >
            <Play className="h-4 w-4 mr-2" />
            {lineupReady ? "Start Game" : `Drag ${7 - onCourtCount} more onto court`}
          </Button>
        </div>
      )}
    </div>
  );
}
