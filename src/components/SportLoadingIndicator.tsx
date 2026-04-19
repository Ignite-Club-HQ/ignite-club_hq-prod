import { cn } from "@/lib/utils";

/**
 * Sport-themed loading indicator shown while the game board is lazy-loading.
 *
 * Renders a bouncing ball (basketball or netball) using pure CSS so we
 * don't pull in any animation library. The ball uses a subtle squash on
 * impact and a soft shadow under it to read as physically grounded.
 */
type SportKind = "basketball" | "netball" | "default";

interface SportLoadingIndicatorProps {
  kind: SportKind;
  label?: string;
}

export default function SportLoadingIndicator({
  kind,
  label,
}: SportLoadingIndicatorProps) {
  const isBasketball = kind === "basketball";
  const isNetball = kind === "netball";
  const showSportBall = isBasketball || isNetball;

  const defaultLabel = isBasketball
    ? "Tipping off…"
    : isNetball
      ? "Centre pass…"
      : "Loading…";

  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-[300px] gap-6 bg-card">
      {showSportBall ? (
        <div className="relative h-20 w-20" aria-hidden="true">
          {/* Ball */}
          <div
            className={cn(
              "absolute left-1/2 -translate-x-1/2 h-12 w-12 rounded-full shadow-lg",
              "animate-[sport-bounce_0.9s_cubic-bezier(0.5,0,0.5,1)_infinite]",
              isBasketball
                ? "bg-[hsl(22_85%_52%)] before:content-[''] before:absolute before:inset-0 before:rounded-full before:border-2 before:border-[hsl(22_50%_25%)]/70"
                : "bg-[hsl(28_90%_58%)] before:content-[''] before:absolute before:inset-0 before:rounded-full before:border-2 before:border-white/60",
            )}
            style={{ top: 0 }}
          >
            {/* Seam lines */}
            {isBasketball ? (
              <>
                <span className="absolute inset-0 rounded-full border-t-2 border-[hsl(22_50%_25%)]/70" />
                <span className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[2px] bg-[hsl(22_50%_25%)]/70" />
                <span className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[2px] bg-[hsl(22_50%_25%)]/70" />
              </>
            ) : (
              <>
                <span className="absolute inset-2 rounded-full border-2 border-white/50" />
                <span className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[2px] bg-white/40" />
              </>
            )}
          </div>
          {/* Shadow */}
          <div
            className="absolute bottom-0 left-1/2 -translate-x-1/2 h-2 w-12 rounded-full bg-foreground/20 blur-sm animate-[sport-shadow_0.9s_cubic-bezier(0.5,0,0.5,1)_infinite]"
          />
        </div>
      ) : (
        <div className="h-12 w-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
      )}
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {label ?? defaultLabel}
      </p>

      <style>{`
        @keyframes sport-bounce {
          0%, 100% {
            transform: translate(-50%, 0) scaleY(1);
          }
          45% {
            transform: translate(-50%, 50px) scaleY(1);
          }
          55% {
            transform: translate(-50%, 50px) scaleY(0.78);
          }
          65% {
            transform: translate(-50%, 50px) scaleY(1);
          }
        }
        @keyframes sport-shadow {
          0%, 100% {
            transform: translate(-50%, 0) scale(0.7);
            opacity: 0.25;
          }
          50% {
            transform: translate(-50%, 0) scale(1.1);
            opacity: 0.5;
          }
        }
      `}</style>
    </div>
  );
}
