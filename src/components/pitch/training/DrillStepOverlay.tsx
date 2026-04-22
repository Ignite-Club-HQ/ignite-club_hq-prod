import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";

interface DrillStepOverlayProps {
  frameNumber: number;
  totalFrames: number;
  notes: string;
  /** When true (Run Drill mode), the card is anchored bottom; otherwise top-left. */
  anchor?: "top" | "bottom";
}

/**
 * Floating, semi-transparent coaching card. Sits OVER the pitch (never blocks
 * the centre play area). Shows up to 2 lines collapsed, expands on tap.
 */
function DrillStepOverlayImpl({
  frameNumber,
  totalFrames,
  notes,
  anchor = "top",
}: DrillStepOverlayProps) {
  const [expanded, setExpanded] = useState(false);
  const hasNotes = !!notes?.trim();

  return (
    <div
      className={cn(
        "absolute z-[60] pointer-events-auto",
        anchor === "top" ? "top-2 left-2 right-auto max-w-[78%]" : "bottom-2 left-2 right-2 sm:right-auto sm:max-w-[78%]"
      )}
    >
      <button
        type="button"
        onClick={() => hasNotes && setExpanded((e) => !e)}
        className={cn(
          "w-full text-left rounded-lg backdrop-blur-md border border-white/15 shadow-lg",
          "bg-black/65 text-white px-3 py-2 transition-colors",
          hasNotes ? "hover:bg-black/75 active:bg-black/80 cursor-pointer" : "cursor-default"
        )}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2 mb-0.5">
          <span className="inline-flex items-center justify-center h-5 px-2 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold tabular-nums">
            Step {frameNumber} of {totalFrames}
          </span>
          {hasNotes && (
            <span className="ml-auto text-white/60">
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </span>
          )}
        </div>
        <p
          className={cn(
            "text-[13px] leading-snug",
            !expanded && "line-clamp-2",
            !hasNotes && "italic text-white/70"
          )}
        >
          {hasNotes ? notes : "No coaching notes for this step."}
        </p>
      </button>
    </div>
  );
}

export const DrillStepOverlay = memo(DrillStepOverlayImpl);
export default DrillStepOverlay;
