import { memo, useEffect, useRef, useState, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { hapticSelectionTick } from "@/lib/haptics";

interface LiveScoreboardBarProps {
  homeLabel: string;
  awayLabel: string;
  homeScore: number;
  awayScore: number;
  /** Allowed point increments (basketball: [1,2,3]; netball: [1]). */
  increments: number[];
  readOnly?: boolean;
  disabled?: boolean;
  onScore: (side: "home" | "away", points: number) => void;
  /** Optional left-side controls (period pill, clock, play/pause). */
  leadingSlot?: ReactNode;
  /** Optional right-side controls (sync indicator, etc.). */
  trailingSlot?: ReactNode;
}

/**
 * Single-row live control strip:
 *   [leadingSlot]  [+1+2+3] HOME 12 — 8 AWAY [+1+2+3]  [trailingSlot]
 *
 * Everything — period, clock, play/pause, scores and scoring buttons — fits
 * in one horizontal strip. One tap = one point change. Score number flashes
 * on update.
 */
const LiveScoreboardBar = memo(function LiveScoreboardBar({
  homeLabel,
  awayLabel,
  homeScore,
  awayScore,
  increments,
  readOnly = false,
  disabled = false,
  onScore,
  leadingSlot,
  trailingSlot,
}: LiveScoreboardBarProps) {
  const interactive = !readOnly && !disabled;

  const handleScore = (side: "home" | "away", pts: number) => {
    if (!interactive) return;
    hapticSelectionTick();
    onScore(side, pts);
  };

  return (
    <div
      className="flex items-center gap-1.5 px-1.5 py-1 bg-card border-b"
      role="group"
      aria-label="Live scoreboard"
    >
      {leadingSlot && <div className="flex items-center gap-1 shrink-0">{leadingSlot}</div>}

      <TeamSide
        label={homeLabel}
        score={homeScore}
        increments={increments}
        interactive={interactive}
        onScore={(pts) => handleScore("home", pts)}
        side="home"
      />

      <span className="text-base font-light text-muted-foreground/50 px-0.5 leading-none shrink-0">
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

      {trailingSlot && <div className="flex items-center gap-1 shrink-0">{trailingSlot}</div>}
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
  const prevScore = useRef(score);

  useEffect(() => {
    if (prevScore.current !== score) {
      prevScore.current = score;
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
          className="h-7 min-h-0 min-w-7 px-1.5 text-[11px] font-bold rounded leading-none"
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
        className="text-[8px] font-semibold uppercase tracking-wide text-muted-foreground/70 truncate max-w-full"
        title={label}
      >
        {label}
      </span>
      <span
        className={cn(
          "text-2xl font-extrabold tabular-nums leading-none text-foreground transition-transform mt-0.5",
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

export default LiveScoreboardBar;
