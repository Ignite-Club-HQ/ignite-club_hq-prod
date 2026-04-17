import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

interface PreTipoffHintProps {
  /** Total bodies the coach needs on court (5 basketball, 7 netball). */
  required: number;
  currentOnCourt: number;
  onOpenPlanner: () => void;
  onOpenPresets?: () => void;
  hasPresets?: boolean;
}

/**
 * Subtle pre-tipoff banner that nudges coaches to set their starting lineup
 * before the timer begins. Only renders before kickoff (Q1, elapsed=0, not running)
 * — checked by the caller. Not dismissable: it disappears on its own once the
 * timer starts ticking.
 */
export default function PreTipoffHint({
  required,
  currentOnCourt,
  onOpenPlanner,
  onOpenPresets,
  hasPresets,
}: PreTipoffHintProps) {
  const ready = currentOnCourt === required;

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b bg-primary/5 text-xs">
      <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
      <span className="flex-1 min-w-0 truncate">
        {ready ? (
          <span className="text-foreground">
            Starting {required} ready. Tip off when you are.
          </span>
        ) : (
          <span className="text-muted-foreground">
            Set your starting {required} before tip-off (
            <span className="font-semibold text-foreground">
              {currentOnCourt}/{required}
            </span>
            )
          </span>
        )}
      </span>
      {hasPresets && onOpenPresets && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={onOpenPresets}
        >
          Use preset
        </Button>
      )}
      <Button
        size="sm"
        variant={ready ? "ghost" : "default"}
        className="h-7 text-xs"
        onClick={onOpenPlanner}
      >
        {ready ? "Edit" : "Set lineup"}
      </Button>
    </div>
  );
}
