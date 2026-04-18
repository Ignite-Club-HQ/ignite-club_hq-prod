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
        "rounded-2xl border border-border/40 bg-card/85 backdrop-blur-md shadow-lg",
        "transition-opacity duration-150",
        position === "top" ? "top-2" : "bottom-2",
        suppressed && "opacity-30 pointer-events-none",
      )}
      role="group"
      aria-label="Live game HUD"
    >
      {/* Row 1 — small control strip */}
      <div className="flex items-center justify-center gap-2 px-2 pt-1.5 pb-0.5">
        <div className="flex items-center gap-1">{controlSlot}</div>
        {trailingSlot && (
          <div className="absolute right-2 top-1.5 flex items-center">{trailingSlot}</div>
        )}
        {onTogglePosition && (
          <Button
            size="icon"
            variant="ghost"
            className="absolute left-1 top-1 h-6 w-6 min-h-0 min-w-0 rounded-full text-muted-foreground hover:text-foreground"
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
      <div className="flex items-center gap-1.5 px-2 pb-1.5">
        <TeamSide
          label={homeLabel}
          score={homeScore}
          increments={increments}
          interactive={interactive}
          onScore={(pts) => handleScore("home", pts)}
          side="home"
        />

        <span className="text-xl font-light text-muted-foreground/50 px-0.5 leading-none shrink-0">
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

        <span className="text-xl font-light text-muted-foreground/50 px-0.5 leading-none shrink-0">
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

  const buttons = interactive && (
    <div className="flex items-center gap-0.5 shrink-0">
      {increments.map((pts) => (
        <Button
          key={pts}
          size="sm"
          variant="secondary"
          className="h-6 min-h-0 min-w-6 px-1 text-[10px] font-bold rounded leading-none"
          onClick={() => onScore(pts)}
          aria-label={`Add ${pts} point${pts === 1 ? "" : "s"} for ${label}`}
        >
          +{pts}
        </Button>
      ))}
    </div>
  );

  const labelAndScore = (
    <div
      className={cn(
        "flex flex-col min-w-0 leading-none",
        side === "home" ? "items-end" : "items-start",
      )}
    >
      <span
        className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/70 truncate max-w-full"
        title={label}
      >
        {label}
      </span>
      <span
        className={cn(
          "text-3xl font-black tabular-nums leading-none text-foreground transition-transform mt-0.5",
          pulse && "scale-110 text-primary",
        )}
        aria-live="polite"
        aria-label={`${label} score ${score}`}
      >
        {score}
      </span>
    </div>
  );

  return (
    <div
      className={cn(
        "flex flex-1 items-center gap-1.5 min-w-0",
        side === "home" ? "justify-end" : "justify-start",
      )}
    >
      {side === "home" ? (
        <>
          {buttons}
          {labelAndScore}
        </>
      ) : (
        <>
          {labelAndScore}
          {buttons}
        </>
      )}
    </div>
  );
}

export default LiveGameHUD;
