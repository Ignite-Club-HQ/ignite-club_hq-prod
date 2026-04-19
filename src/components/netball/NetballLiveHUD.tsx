import { ReactNode, memo, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowDownToLine, ArrowUpToLine, MoreHorizontal, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { hapticSelectionTick } from "@/lib/haptics";

interface NetballLiveHUDProps {
  homeLabel: string;
  awayLabel: string;
  homeScore: number;
  awayScore: number;
  readOnly?: boolean;
  /** Disable scoring (e.g. game finished). */
  disabled?: boolean;
  /** Dim everything (selection mode). */
  suppressed?: boolean;
  onScore: (side: "home" | "away") => void;
  onBack: () => void;
  /** Period · clock · play/pause · timer overflow — supplied by board. */
  controlSlot: ReactNode;
  /** Sync indicator. */
  trailingSlot?: ReactNode;
  /** Extra actions (auto-subs status, etc.) injected into the overflow menu. */
  overflowSlot?: ReactNode;
  /** Whether the HUD is pinned to the top or bottom of the court. */
  position?: "top" | "bottom";
  /** Toggle the HUD between top and bottom. */
  onTogglePosition?: () => void;
}

/**
 * Netball live-game top bar.
 *
 * A single compact row pinned above the court that fuses the back chip,
 * timer/period/play controls, sync indicator, overflow menu, and a one-line
 * scoreboard with inline +1 chips. Designed to be much shorter than the
 * shared {@link LiveGameHUD} so the court dominates during live play.
 *
 * Layout (top → bottom, all inside one floating card):
 *   row 1: ← back  ·  Q1 0:00 ▶  ·  More
 *   row 2: Swish  18  —  12  Opponent  (with +1 chips beside each score)
 */
const NetballLiveHUD = memo(function NetballLiveHUD({
  homeLabel,
  awayLabel,
  homeScore,
  awayScore,
  readOnly = false,
  disabled = false,
  suppressed = false,
  onScore,
  onBack,
  controlSlot,
  trailingSlot,
  overflowSlot,
  position = "top",
  onTogglePosition,
}: NetballLiveHUDProps) {
  const interactive = !readOnly && !disabled && !suppressed;

  const handleScore = (side: "home" | "away") => {
    if (!interactive) return;
    hapticSelectionTick();
    onScore(side);
  };

  const isBottom = position === "bottom";

  return (
    <div
      className={cn(
        "absolute left-2 right-2 z-30 mx-auto max-w-md",
        isBottom ? "bottom-2" : "top-2",
        "rounded-xl border border-border bg-card",
        "shadow-[0_4px_14px_-6px_hsl(var(--foreground)/0.25)]",
        "transition-[opacity,filter,transform] duration-200 ease-out",
        suppressed && "opacity-40 blur-[1px] pointer-events-none scale-[0.99]",
      )}
      role="group"
      aria-label="Live game HUD"
    >
      {/* Row 1 — control strip: back · timer · trailing · overflow */}
      <div className="relative flex items-center gap-1.5 px-1.5 py-1 min-h-[2.5rem]">
        <Button
          size="icon"
          variant="ghost"
          onClick={onBack}
          aria-label="Close"
          className="h-8 w-8 shrink-0 rounded-full"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="flex-1 min-w-0 flex items-center justify-center gap-1.5">
          {controlSlot}
        </div>

        {trailingSlot && (
          <div className="shrink-0 flex items-center">{trailingSlot}</div>
        )}

        {onTogglePosition && (
          <Button
            size="icon"
            variant="ghost"
            onClick={onTogglePosition}
            aria-label={isBottom ? "Move HUD to top" : "Move HUD to bottom"}
            title={isBottom ? "Move to top" : "Move to bottom"}
            className="h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
          >
            {isBottom ? (
              <ArrowUpToLine className="h-4 w-4" />
            ) : (
              <ArrowDownToLine className="h-4 w-4" />
            )}
          </Button>
        )}

        {overflowSlot && <div className="shrink-0">{overflowSlot}</div>}
      </div>

      {/* Row 2 — single-line scoreboard. Score is the dominant text after
          the timer; team names are secondary supporting labels. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 px-2 pb-1.5 pt-0.5 border-t border-border/40">
        <ScoreSide
          label={homeLabel}
          score={homeScore}
          interactive={interactive}
          onScore={() => handleScore("home")}
          side="home"
        />

        <span className="text-base font-light text-muted-foreground/40 leading-none shrink-0 self-center pb-0.5 px-0.5">
          –
        </span>

        <ScoreSide
          label={awayLabel}
          score={awayScore}
          interactive={interactive}
          onScore={() => handleScore("away")}
          side="away"
        />
      </div>
    </div>
  );
});

interface ScoreSideProps {
  label: string;
  score: number;
  interactive: boolean;
  onScore: () => void;
  side: "home" | "away";
}

function ScoreSide({ label, score, interactive, onScore, side }: ScoreSideProps) {
  const [pulse, setPulse] = useState(false);
  const prev = useRef(score);

  useEffect(() => {
    if (prev.current !== score) {
      prev.current = score;
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 320);
      return () => clearTimeout(t);
    }
  }, [score]);

  const isHome = side === "home";

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 min-w-0",
        isHome ? "justify-start" : "justify-end flex-row-reverse",
      )}
    >
      {/* Tap-the-score = +1. Big number + tiny team name beneath. */}
      <button
        type="button"
        onClick={onScore}
        disabled={!interactive}
        aria-label={`Add 1 point for ${label}`}
        className={cn(
          "flex flex-col leading-none px-1 py-0.5 rounded-md transition-all",
          "active:scale-95",
          interactive
            ? "hover:bg-secondary/40 cursor-pointer"
            : "cursor-default opacity-90",
          isHome ? "items-start" : "items-end",
        )}
      >
        <span
          className={cn(
            "text-2xl font-black tabular-nums leading-none text-foreground transition-transform duration-150 ease-out",
            pulse && "scale-[1.18] text-primary drop-shadow-[0_0_8px_hsl(var(--primary)/0.4)]",
          )}
          aria-live="polite"
        >
          {score}
        </span>
        <span
          className={cn(
            "text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/65 leading-none mt-0.5 max-w-[8.5rem] truncate",
          )}
          title={label}
        >
          {label}
        </span>
      </button>

      {/* Inline +1 chip — the small explicit affordance next to the score. */}
      {interactive && (
        <Button
          size="icon"
          variant="ghost"
          onClick={onScore}
          aria-label={`Add 1 point for ${label}`}
          className={cn(
            "h-6 w-6 min-h-0 min-w-0 rounded-full text-[11px] font-bold",
            "bg-secondary/40 hover:bg-secondary/70 text-foreground/80",
            "active:scale-90 active:bg-primary/30 transition-all duration-100",
          )}
        >
          <Plus className="h-3 w-3" strokeWidth={3} />
        </Button>
      )}
    </div>
  );
}

/**
 * Convenience overflow trigger for the HUD — keeps the styling
 * consistent across boards. The `children` are the dropdown content.
 */
export function NetballLiveHUDOverflow({ children, ariaLabel = "More options" }: { children: ReactNode; ariaLabel?: string }) {
  return (
    <Button
      size="icon"
      variant="ghost"
      className="h-8 w-8 rounded-full shrink-0"
      aria-label={ariaLabel}
    >
      <MoreHorizontal className="h-4 w-4" />
      {children}
    </Button>
  );
}

export default NetballLiveHUD;
