import { ReactNode, memo, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { hapticSelectionTick } from "@/lib/haptics";

export type HUDPosition = "top" | "bottom";

interface LiveGameHUDProps {
  homeLabel: string;
  awayLabel: string;
  homeScore: number;
  awayScore: number;
  increments: number[];
  readOnly?: boolean;
  disabled?: boolean;
  onScore: (side: "home" | "away", points: number) => void;
  /** Top control row (period · clock · play). */
  controlSlot: ReactNode;
  /** Optional small trailing element (sync indicator). */
  trailingSlot?: ReactNode;
  /** Dim + disable taps when true (e.g. while dragging a player). */
  suppressed?: boolean;
  /** Anchor the HUD to top or bottom of the court. */
  position?: HUDPosition;
  /** Fired when user taps the dock-toggle chip. */
  onTogglePosition?: () => void;
}

/**
 * Floating in-game HUD overlaid on top of the court.
 * Can be docked to the top or bottom of the court (toggleable).
 */
const LiveGameHUD = memo(function LiveGameHUD({
  homeLabel,
  awayLabel,
  homeScore,
  awayScore,
  increments,
  readOnly = false,
  disabled = false,
  onScore,
  controlSlot,
  trailingSlot,
  suppressed = false,
  position = "top",
  onTogglePosition,
}: LiveGameHUDProps) {
  const interactive = !readOnly && !disabled && !suppressed;

  const handleScore = (side: "home" | "away", pts: number) => {
    if (!interactive) return;
    hapticSelectionTick();
    onScore(side, pts);
  };

  return (
    <div
      className={cn(
        "absolute left-1/2 -translate-x-1/2 z-30 w-[calc(100%-1rem)] max-w-md",
        // Solid surface — fully blocks court lines beneath so score/buttons
        // are never read against painted lines. Defined border + crisp shadow.
        "rounded-xl border border-border bg-card",
        "shadow-[0_4px_16px_-6px_hsl(var(--foreground)/0.25)]",
        "transition-[opacity,filter,transform] duration-200 ease-out",
        position === "top" ? "top-2" : "bottom-2",
        suppressed && "opacity-40 blur-[1px] pointer-events-none scale-[0.99]",
      )}
      role="group"
      aria-label="Live game HUD"
    >
      {/* Row 1 — small control strip */}
      <div className="flex items-center justify-center gap-2 px-2 pt-0.5 pb-0">
        <div className="flex items-center gap-1">{controlSlot}</div>
        {trailingSlot && (
          <div className="absolute right-2 top-0.5 flex items-center">{trailingSlot}</div>
        )}
        {onTogglePosition && (
          <Button
            size="icon"
            variant="ghost"
            className="absolute right-1 top-0.5 h-6 w-6 min-h-0 min-w-0 rounded-full bg-background/70 border border-border/60 text-foreground/80 hover:text-foreground hover:bg-background shadow-sm"
            onClick={onTogglePosition}
            aria-label={position === "top" ? "Move HUD to bottom" : "Move HUD to top"}
          >
            {position === "top" ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
      </div>

      {/* Row 2 — dominant scores + scoring buttons */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-2 pb-1">
        <TeamSide
          label={homeLabel}
          score={homeScore}
          increments={increments}
          interactive={interactive}
          onScore={(pts) => handleScore("home", pts)}
          side="home"
        />

        <span className="text-base font-light text-muted-foreground/35 leading-none shrink-0 self-center pb-0.5">
          —
        </span>

        <TeamSide
          label={awayLabel}
          score={awayScore}
          increments={increments}
          interactive={interactive}
          onScore={(pts) => handleScore("away", pts)}
          side="away"
        />
      </div>
    </div>
  );
});

interface TeamSideProps {
  label: string;
  score: number;
  increments: number[];
  interactive: boolean;
  onScore: (points: number) => void;
  side: "home" | "away";
}

function TeamSide({ label, score, increments, interactive, onScore, side }: TeamSideProps) {
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

  return (
    <div className="flex flex-col min-w-0">
      {/* Team name */}
      <span
        className={cn(
          "text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/55 leading-none mb-0.5",
          "overflow-hidden whitespace-nowrap",
          side === "home" ? "text-right" : "text-left",
          side === "home"
            ? "[mask-image:linear-gradient(to_left,black_85%,transparent)]"
            : "[mask-image:linear-gradient(to_right,black_85%,transparent)]",
        )}
        title={label}
      >
        {label}
      </span>

      {/* Score */}
      <div className={cn("flex", side === "home" ? "justify-end" : "justify-start")}>
        <ScoreNumber score={score} label={label} pulse={pulse} />
      </div>

      {/* Scoring buttons — own row, lighter visual weight so players dominate */}
      {interactive && (
        <div
          className={cn(
            "flex items-center gap-1 mt-1",
            side === "home" ? "justify-end" : "justify-start",
          )}
        >
          {increments.map((pts) => (
            <Button
              key={pts}
              size="sm"
              variant="ghost"
              className={cn(
                "h-7 min-h-0 min-w-8 px-1.5 text-[11px] font-bold rounded-md leading-none",
                "bg-secondary/40 hover:bg-secondary/70 text-foreground/80 transition-all duration-100",
                "active:scale-90 active:bg-primary/30",
              )}
              onClick={() => onScore(pts)}
              aria-label={`Add ${pts} point${pts === 1 ? "" : "s"} for ${label}`}
            >
              +{pts}
            </Button>
          ))}
        </div>
      )}
      {/* When scoring is gated (e.g. game not started), show subtle dimmed
          buttons so the coach knows where +1/+2/+3 will appear. */}
      {!interactive && (
        <div
          className={cn(
            "flex items-center gap-1 mt-1 opacity-40",
            side === "home" ? "justify-end" : "justify-start",
          )}
          aria-hidden
        >
          {increments.map((pts) => (
            <span
              key={pts}
              className="h-7 min-w-8 px-1.5 text-[11px] font-bold rounded-md leading-none inline-flex items-center justify-center bg-secondary/30 text-muted-foreground"
            >
              +{pts}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ScoreNumber({ score, label, pulse }: { score: number; label: string; pulse: boolean }) {
  return (
    <span
      className={cn(
        "text-3xl font-black tabular-nums leading-none text-foreground shrink-0",
        "transition-transform duration-150 ease-out will-change-transform",
        pulse && "scale-[1.15] text-primary drop-shadow-[0_0_8px_hsl(var(--primary)/0.4)]",
      )}
      aria-live="polite"
      aria-label={`${label} score ${score}`}
    >
      {score}
    </span>
  );
}

export default LiveGameHUD;
