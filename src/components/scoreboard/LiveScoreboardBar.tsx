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
 * Dominant single-row live scoreboard with always-visible quick-score buttons:
 *   [ HOOPS U12 ]      12  —  8      [ OPPONENT ]
 *   [+1][+2][+3]              [+1][+2][+3]
 *
 * - One-tap scoring: every increment is a single button press, no menus.
 * - Score number flashes + scales on update for instant feedback.
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
      className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 px-3 py-2 bg-card border-b"
      role="group"
      aria-label="Live scoreboard"
    >
      {/* HOME */}
      <TeamColumn
        label={homeLabel}
        score={homeScore}
        increments={increments}
        interactive={interactive}
        onScore={(pts) => handleScore("home", pts)}
        align="end"
      />

      {/* DASH separator — aligned to the score row */}
      <span className="text-3xl font-light text-muted-foreground/50 px-1 pt-4 leading-none">
        —
      </span>

      {/* AWAY */}
      <TeamColumn
        label={awayLabel}
        score={awayScore}
        increments={increments}
        interactive={interactive}
        onScore={(pts) => handleScore("away", pts)}
        align="start"
      />
    </div>
  );
});

interface TeamColumnProps {
  label: string;
  score: number;
  increments: number[];
  interactive: boolean;
  onScore: (points: number) => void;
  align: "start" | "end";
}

function TeamColumn({ label, score, increments, interactive, onScore, align }: TeamColumnProps) {
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

  return (
    <div
      className={cn(
        "flex flex-col min-w-0 gap-1",
        align === "end" ? "items-end" : "items-start",
      )}
    >
      <span
        className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 truncate max-w-full"
        title={label}
      >
        {label}
      </span>
      <span
        className={cn(
          "text-5xl font-extrabold tabular-nums leading-none text-foreground landscape:text-6xl transition-transform",
          pulse && "scale-110 text-primary",
        )}
        aria-live="polite"
        aria-label={`${label} score ${score}`}
      >
        {score}
      </span>
      {interactive && (
        <div
          className={cn(
            "flex items-center gap-1 mt-1",
            align === "end" ? "justify-end" : "justify-start",
          )}
        >
          {increments.map((pts) => (
            <Button
              key={pts}
              size="sm"
              variant="secondary"
              className="h-9 min-w-10 px-2 text-sm font-bold rounded-md active:scale-95"
              onClick={() => onScore(pts)}
              aria-label={`Add ${pts} point${pts === 1 ? "" : "s"} for ${label}`}
            >
              +{pts}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export default LiveScoreboardBar;
