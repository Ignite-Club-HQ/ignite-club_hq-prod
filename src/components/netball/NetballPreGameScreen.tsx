import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Bookmark,
  Eye,
  MoreHorizontal,
  Play,
  Repeat,
  Settings,
  Sparkles,
  UserCheck,
  Users,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import NetballPreGameLineup from "./NetballPreGameLineup";
import NetballRotationPreview from "./NetballRotationPreview";
import {
  NetballPlayer,
  NetballPosition,
  NetballSubEvent,
  NETBALL_POSITIONS,
  PeriodType,
  RotationMode,
  ValidationMode,
} from "./types";
import { suggestQuarterLineup } from "./netballHelpers";

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
  /** Full plan — drives the inline preview card and the Rotation tab. */
  autoSubPlan?: NetballSubEvent[];

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

type PreGameTab = "lineup" | "rotation" | "stats";

/**
 * Touch-first pre-game / lineup-builder screen for netball.
 *
 * Header hierarchy: team vs opponent + single-line metadata
 * (selected · format · auto-subs). A tab system slots in directly
 * underneath (Lineup is the only live tab today; Rotation / Stats are
 * stubbed for future work). The court owns most of the viewport, the
 * bench scrolls horizontally underneath, and the bottom action bar
 * surfaces a single primary CTA — Auto-fill until the 7 are placed,
 * then "Ready to start".
 *
 * Logic is unchanged: assignment + auto-sub controls all forward to the
 * existing board callbacks. Only the surface, hierarchy and CTAs are
 * being refactored.
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
  autoSubPlan = [],
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
  const [tab, setTab] = useState<PreGameTab>("lineup");
  const onCourtCount = players.filter((p) => p.position !== null).length;
  const lineupReady = onCourtCount >= 7;
  const periodLabel = periodType === "halves" ? "half" : "quarter";
  const periodCount = periodType === "halves" ? 2 : 4;
  const squadEmpty = players.length === 0;
  const autoSubActive = rotationMode !== "off";
  const showSpeedPicker = autoSubActive && rotationMode === "time-based";
  const canPreview = autoSubActive && hasAutoSubPlan && lineupReady && !!onPreviewPlan;

  /**
   * Auto-fill: clear bench placements and use the existing
   * `suggestQuarterLineup` helper (preferred positions + minutes
   * fairness). Only touches assignments via the supplied `onAssign`
   * callback, so all board-side validation / persistence still runs.
   *
   * `availabilityOnly` is the smart-assist variant — it looks at the
   * `isInjured` flag (the only availability signal we surface in
   * pre-game today) and keeps anyone marked injured on the bench.
   */
  const handleAutoFill = (availabilityOnly = false) => {
    if (readOnly) return;
    const pool = availabilityOnly
      ? players.filter((p) => !p.isInjured)
      : players;
    // Reset court, then assign via suggestion helper.
    players.forEach((p) => {
      if (p.position !== null) onAssign(p.id, null);
    });
    const assignments = suggestQuarterLineup(pool, {});
    NETBALL_POSITIONS.forEach((pos) => {
      const id = assignments[pos];
      if (id) onAssign(id, pos);
    });
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* ── HEADER ──────────────────────────────────────────────── */}
      <header className="flex items-center gap-1 px-2 pt-2 pb-1.5 border-b bg-card sticky top-0 z-20">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label="Close"
          className="flex-shrink-0 h-8 w-8"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-[13px] truncate leading-tight">
            <span className="text-foreground">{teamName}</span>
            <span className="text-muted-foreground mx-1 font-normal">vs</span>
            <span className="text-foreground">{opponentName}</span>
          </h1>
          <p className="text-[10.5px] text-muted-foreground truncate leading-tight mt-0.5 tabular-nums">
            <span
              className={cn(
                "font-semibold",
                lineupReady ? "text-primary" : "text-foreground/80"
              )}
            >
              {onCourtCount} / 7 selected
            </span>
            <span className="mx-1.5 opacity-50">•</span>
            <span>
              {periodCount} × {minutesPerQuarter}m
            </span>
            <span className="mx-1.5 opacity-50">•</span>
            <span>Auto-subs {autoSubActive ? "ON" : "OFF"}</span>
          </p>
        </div>

        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 flex-shrink-0"
              aria-label="More options"
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={onOpenSquad} disabled={readOnly}>
              <Users className="h-4 w-4 mr-2" />
              Squad ({players.length})
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenSettings} disabled={readOnly}>
              <Settings className="h-4 w-4 mr-2" />
              Game settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onToggleAutoSub?.(autoSubActive ? "off" : "time-based")}
              disabled={readOnly || !onToggleAutoSub}
            >
              <Repeat className="h-4 w-4 mr-2" />
              {autoSubActive ? "Turn auto-subs off" : "Turn auto-subs on"}
            </DropdownMenuItem>
            {canPreview && (
              <DropdownMenuItem onClick={onPreviewPlan}>
                <Eye className="h-4 w-4 mr-2" />
                Preview plan
              </DropdownMenuItem>
            )}
            {hasPresets && (
              <DropdownMenuItem onClick={onOpenPresets} disabled={readOnly}>
                <Bookmark className="h-4 w-4 mr-2" />
                Presets
              </DropdownMenuItem>
            )}
            {onOpenLineups && (
              <DropdownMenuItem onClick={onOpenLineups} disabled={readOnly}>
                <Sparkles className="h-4 w-4 mr-2" />
                Quarter lineups
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* ── TABS ────────────────────────────────────────────────── */}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as PreGameTab)}
        className="flex-1 min-h-0 flex flex-col"
      >
        <TabsList className="mx-2 mt-1.5 mb-1 grid grid-cols-2 h-8 bg-muted/60">
          <TabsTrigger value="lineup" className="text-[11px] font-semibold">
            Lineup
          </TabsTrigger>
          <TabsTrigger
            value="rotation"
            className="text-[11px] font-semibold gap-1"
          >
            Rotation
            {autoSubActive && hasAutoSubPlan && (
              <span
                className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold tabular-nums"
                aria-label={`${autoSubPlan.length} swaps planned`}
              >
                {autoSubPlan.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Auto-sub speed sub-row — only relevant in lineup tab */}
        {tab === "lineup" && showSpeedPicker && (
          <div className="px-3 pb-1 flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
              Rotate every
            </span>
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
                      "px-2 h-5 rounded-full text-[10px] font-semibold tabular-nums transition-colors disabled:opacity-60",
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
          </div>
        )}

        <TabsContent
          value="lineup"
          className="flex-1 min-h-0 m-0 data-[state=inactive]:hidden flex flex-col overflow-hidden"
        >
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
        </TabsContent>

        <TabsContent
          value="rotation"
          className="flex-1 min-h-0 m-0 data-[state=inactive]:hidden flex flex-col overflow-hidden"
        >
          <NetballRotationPreview
            rotationMode={rotationMode}
            rotationIntervalMinutes={rotationIntervalMinutes}
            autoSubPlan={autoSubPlan}
            players={players}
            minutesPerQuarter={minutesPerQuarter}
            periodType={periodType}
            onEditPlan={() => onOpenLineups?.()}
            onPreviewPlan={() => onPreviewPlan?.()}
            onToggleAutoSub={(next) => onToggleAutoSub?.(next)}
            readOnly={readOnly}
          />
        </TabsContent>

      </Tabs>

      {/* ── BOTTOM ACTION BAR ───────────────────────────────────── */}
      {!readOnly && !squadEmpty && tab === "lineup" && (
        <div className="sticky bottom-0 px-3 py-2 border-t bg-card/95 backdrop-blur flex items-center gap-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="flex flex-col leading-tight">
            <span
              className={cn(
                "text-[11px] font-bold tabular-nums tracking-wide",
                lineupReady ? "text-primary" : "text-foreground"
              )}
            >
              {onCourtCount} / 7
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              On court
            </span>
          </div>

          {!lineupReady && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 flex-shrink-0"
                  aria-label="Smart assist options"
                >
                  <Sparkles className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem onClick={() => handleAutoFill(true)}>
                  <UserCheck className="h-4 w-4 mr-2" />
                  Fill by availability
                </DropdownMenuItem>
                {hasPresets && (
                  <DropdownMenuItem onClick={onOpenPresets}>
                    <Bookmark className="h-4 w-4 mr-2" />
                    Apply preset
                  </DropdownMenuItem>
                )}
                {onOpenLineups && (
                  <DropdownMenuItem onClick={onOpenLineups}>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Plan all quarters
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Button
            size="lg"
            className={cn(
              "flex-1 h-11 text-sm font-semibold",
              lineupReady && "animate-scale-in"
            )}
            onClick={lineupReady ? onStartGame : () => handleAutoFill(false)}
          >
            {lineupReady ? (
              <>
                <Play className="h-4 w-4 mr-2" />
                Ready to start
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Auto-fill lineup
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
