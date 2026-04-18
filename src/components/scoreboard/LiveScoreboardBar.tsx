import { memo, useEffect, useRef, useState } from "react";
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
}

/**
 * Compact single-row live scoreboard:
 *   [+1 +2 +3]  HOME  12 — 8  AWAY  [+1 +2 +3]
 *
 * Score buttons sit inline with the score number — no second row, no menus.
 * One tap = one point change. Score number flashes on update.
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
}: LiveScoreboardBarProps) {
  const interactive = !readOnly && !disabled;

  const handleScore = (side: "home" | "away", pts: number) => {
    if (!interactive) return;
    hapticSelectionTick();
    onScore(side, pts);
  };

  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 bg-card border-b"
      role="group"
      aria-label="Live scoreboard"
    >
      {/* HOME — buttons | label+score */}
      <TeamSide
        label={homeLabel}
        score={homeScore}
        increments={increments}
        interactive={interactive}
        onScore={(pts) => handleScore("home", pts)}
        side="home"
      />

      {/* DASH separator */}
      <span className="text-xl font-light text-muted-foreground/50 px-0.5 leading-none">—</span>

      {/* AWAY — label+score | buttons */}
      <TeamSide
        label={awayLabel}
        score={awayScore}
        increments={increments}
        interactive={interactive}
        onScore={(pts) => handleScore("away", pts)}
        side="away"
      />
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
    <div className="flex items-center gap-1 shrink-0">
      {increments.map((pts) => (
        <Button
          key={pts}
          size="sm"
          variant="secondary"
          className="h-9 min-w-9 px-2 text-sm font-bold rounded-md active:scale-95"
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
          "text-4xl font-extrabold tabular-nums leading-none text-foreground transition-transform mt-0.5",
          pulse && "scale-110 text-primary",
        )}
        aria-live="polite"
        aria-label={`${label} score ${score}`}
      >
        {score}
      </span>
    </div>
  );

  // HOME: [+1 +2 +3]  LABEL/SCORE  →  pushed toward centre dash
  // AWAY: LABEL/SCORE  [+1 +2 +3]  →  pushed away from dash
  return (
    <div
      className={cn(
        "flex flex-1 items-center gap-2 min-w-0",
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
